// A number field keeps its draft while the range holds the last accepted value.
const boundWorldNumbers = new WeakSet();
const numericBindings = new WeakMap();

export function syncNumericInput(input, value) {
    const reset = numericBindings.get(input);
    if (reset) reset(value);
    else input.value = value;
}

// Shared by the world editor and the location inspector. Empty drafts are not zero.
export function readNumericInput(input, { report = false, precision } = {}) {
    const draft = input.value.trim().replace(',', '.');
    let value = draft === '' ? NaN : Number(draft);
    const minimum = input.min === '' ? -Infinity : Number(input.min);
    const maximum = input.max === '' ? Infinity : Number(input.max);
    let message = '';
    if (!Number.isFinite(value) || input.validity?.badInput) message = 'Введите число';
    else if (value < minimum || value > maximum
        || (input.dataset.exclusiveMax === 'true' && value === maximum)) {
        message = `Допустимый диапазон: ${minimum} … ${maximum}${input.dataset.exclusiveMax === 'true' ? ' (верхняя граница не включена)' : ''}`;
    } else if (input.step === '1' && !Number.isInteger(value)) message = 'Введите целое число';
    input.setCustomValidity(message);
    if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.title = message;
    } else {
        input.removeAttribute('aria-invalid');
        if (input.dataset.numericErrorTitle) input.title = '';
    }
    input.dataset.numericErrorTitle = message;
    if (message && report) input.reportValidity();
    if (message) return NaN;
    if (precision !== undefined) value = Number(value.toFixed(precision));
    return value;
}

export function bindNumericInput(input, { onCommit = () => {}, onInput, precision, blurOnCommit = false } = {}) {
    let committed = input.value.trim() === '' ? NaN : Number(input.value);
    numericBindings.set(input, value => {
        committed = Number(value);
        input.value = value;
        input.dataset.numericDraft = 'false';
        readNumericInput(input, { precision });
    });
    const pending = new Set();
    let generation = 0;
    const commit = async (report = false) => {
        const value = readNumericInput(input, { report, precision });
        if (!Number.isFinite(value)) return false;
        if (pending.has(value)) return false;
        input.value = value;
        if (value === committed && !pending.size) return true;
        input.dataset.numericDraft = 'false';
        pending.add(value);
        const current = ++generation;
        try {
            // Invoke now so callers can capture the draft before a socket echo replaces the DOM.
            // The lamp inspector serializes its REST requests separately.
            if (await onCommit(value) === false) return false;
            if (current === generation) committed = value;
            return true;
        } finally { pending.delete(value); }
    };
    input.addEventListener('input', () => {
        const value = readNumericInput(input, { precision });
        input.dataset.numericDraft = String(value !== committed);
        if (Number.isFinite(value)) onInput?.(value);
    });
    const finish = async report => {
        if (await commit(report) && blurOnCommit && input.dataset.numericDraft !== 'true') input.blur();
    };
    input.addEventListener('change', () => finish(false));
    input.addEventListener('blur', () => commit());
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        finish(true);
    });
    return commit;
}

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
            let value = number.value.trim() === '' ? NaN : Number(number.value.replace(',', '.'));
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
