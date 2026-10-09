import { DEFAULT_LOCATION_LIGHTING } from './locationLighting.js';

const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

export function createLocationLightingEditor(container, initial, onPreview = () => {},
    getLights = () => initial?.local_lights || [], getDarkTiles = () => initial?.dark_tiles || []) {
    const settings = { ...DEFAULT_LOCATION_LIGHTING, ...(initial || {}) };
    const input = (label, key, min, max, step = 0.1) => `
        <label class="location-lighting-field">
            ${label}
            <input class="form-control" type="number" data-lighting="${key}" min="${min}" max="${max}" step="${step}" value="${Number(settings[key])}">
        </label>`;
    container.innerHTML = `
        <label class="location-lighting-field location-lighting-mode">Режим
            <select class="form-control" data-lighting="mode">
                <option value="world">По времени мира</option>
                <option value="manual">Ручной: помещение, подземелье</option>
            </select>
        </label>
        <div class="location-lighting-manual">
            <label class="location-lighting-field">Цвет общего света<input class="form-control" type="color" data-lighting="ambient_color" value="${safeColor(settings.ambient_color, DEFAULT_LOCATION_LIGHTING.ambient_color)}"></label>
            ${input('Яркость общего света', 'ambient_intensity', 0, 3)}
            <label class="location-lighting-field">Цвет направленного света<input class="form-control" type="color" data-lighting="directional_color" value="${safeColor(settings.directional_color, DEFAULT_LOCATION_LIGHTING.directional_color)}"></label>
            ${input('Яркость направленного света', 'directional_intensity', 0, 3)}
            ${input('Направление, °', 'directional_azimuth', -180, 180, 1)}
            ${input('Высота света, °', 'directional_elevation', 0, 90, 1)}
            <label class="location-lighting-field">Цвет фона<input class="form-control" type="color" data-lighting="background_color" value="${safeColor(settings.background_color, DEFAULT_LOCATION_LIGHTING.background_color)}"></label>
        </div>
        <small class="location-lighting-hint">Изменения видны сразу. Лампы размещаются на карте через Библиотеку ассетов.</small>
    `;
    const mode = container.querySelector('[data-lighting="mode"]');
    mode.value = settings.mode === 'manual' ? 'manual' : 'world';
    const manual = container.querySelector('.location-lighting-manual');
    const syncMode = () => { manual.style.display = mode.value === 'manual' ? 'grid' : 'none'; };
    mode.addEventListener('change', syncMode);
    syncMode();

    const editor = {
        get() {
            const value = { mode: mode.value };
            for (const key of Object.keys(DEFAULT_LOCATION_LIGHTING)) {
                if (key === 'mode' || key === 'local_lights' || key === 'dark_tiles') continue;
                const element = container.querySelector(`[data-lighting="${key}"]`);
                value[key] = element.type === 'number' ? Number(element.value) : element.value;
            }
            value.local_lights = getLights().map(light => ({ ...light }));
            value.dark_tiles = getDarkTiles().map(tile => ({ ...tile }));
            return value;
        },
    };
    container.oninput = () => onPreview(editor.get());
    container.onchange = () => onPreview(editor.get());
    return editor;
}
