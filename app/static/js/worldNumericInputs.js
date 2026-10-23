// A number field keeps its draft while the range holds the last accepted value.
const boundWorldNumbers = new WeakSet();

export function getWorldNumericValue(id) {
    const range = document.getElementById(id);
    return Number(range.dataset.worldExactValue ?? range.value);
}

export function syncWorldNumber(id, value) {
    const range = document.getElementById(id);
    const number = document.getElementById(`${id}-number`);
    if (range && value !== undefined) {
        range.dataset.worldExactValue = String(value);
        range.value = value;
    }
    if (range && number && document.activeElement !== number) {
        number.value = getWorldNumericValue(id) + Number(number.dataset.offset || 0);
    }
    const output = document.getElementById(`${id}-value`);
    if (range && output && id !== 'brush-radius') {
        output.textContent = getWorldNumericValue(id) + (id.endsWith('rotation') ? '°' : '');
    }
}

export function initWorldNumericInputs() {
    document.querySelectorAll('[data-world-number]').forEach(number => {
        if (boundWorldNumbers.has(number)) return;
        boundWorldNumbers.add(number);
        const range = document.getElementById(number.dataset.worldNumber);
        const offset = Number(number.dataset.offset || 0);
        let updatingFromNumber = false;
        const apply = commit => {
            let value = number.value.trim() === '' ? NaN : Number(number.value);
            const min = Number(number.min);
            const max = Number(number.max);
            if (commit) {
                value = Number.isFinite(value) ? Math.max(min, Math.min(max, value))
                    : getWorldNumericValue(range.id) + offset;
                if (number.step === '1') value = Math.round(value);
                number.value = value;
            }
            if (!Number.isFinite(value) || value < min || value > max
                || (number.step === '1' && !Number.isInteger(value))) return;
            if (getWorldNumericValue(range.id) !== value - offset) {
                range.dataset.worldExactValue = String(value - offset);
                range.value = value - offset;
                updatingFromNumber = true;
                try {
                    range.dispatchEvent(new Event('input', { bubbles: true }));
                } finally {
                    updatingFromNumber = false;
                }
            }
        };
        number.addEventListener('input', () => apply(false));
        number.addEventListener('change', () => apply(true));
        number.addEventListener('blur', () => apply(true));
        number.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                apply(true);
            }
        });
        // Native slider interaction replaces the exact typed value. The range
        // keeps its native step permanently; its thumb may approximate a typed
        // value, while the number field and game state retain full precision.
        range.addEventListener('input', () => {
            if (!updatingFromNumber) delete range.dataset.worldExactValue;
            syncWorldNumber(range.id);
        }, { capture: true });
        syncWorldNumber(range.id);
    });
}
