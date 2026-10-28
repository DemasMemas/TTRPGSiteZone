// One session-local command order for objects, sparse cell patches and lighting.
export const copy = value => structuredClone(value);
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
}

export function objectChanges(before, after) {
    const changes = { objects: [], tiles: [] };
    const previous = new Map(before.objects.map(o => [o.id, o]));
    const next = new Map(after.objects.map(o => [o.id, o]));
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
        const a = previous.get(id) ?? null, b = next.get(id) ?? null;
        if (!equal(a, b)) changes.objects.push({ id, before: a, after: b });
    }
    for (let z = 0; z < before.tiles.length; z++) for (let x = 0; x < before.tiles[z].length; x++) {
        const a = before.tiles[z][x], b = after.tiles[z][x];
        if (!equal(a, b)) changes.tiles.push({ x, z, before: a, after: b });
    }
    if (!equal(before.lights, after.lights)) changes.lights = { before: before.lights, after: after.lights };
    return changes;
}

export function createLocationEditorHistory(onChange = () => {}, limit = 100) {
    let undo = [], redo = [], busy = false, generation = 0;
    const revisions = new Map();
    const state = () => ({ undo: undo.length, redo: redo.length, busy });
    const notify = () => onChange(state());
    function remember(change) {
        for (const item of change.objects) if (item.after) revisions.set(item.id, item.after.revision);
    }
    return {
        state,
        reset() { generation++; undo = []; redo = []; revisions.clear(); busy = false; notify(); },
        setBusy(value) { busy = value; notify(); },
        push(change) {
            if (!commandParts(change).length) return;
            undo.push(copy(change));
            if (undo.length > limit) undo.shift();
            redo = [];
            remember(change);
            notify();
        },
        async replay(forward, apply) {
            const from = forward ? redo : undo, to = forward ? undo : redo;
            if (busy || !from.length) return false;
            const epoch = generation;
            const change = copy(from.at(-1));
            if (!forward) for (const item of commandParts(change)) {
                [item.before, item.after] = [item.after, item.before];
            }
            for (const item of change.objects) if (item.before && revisions.has(item.id)) item.before.revision = revisions.get(item.id);
            busy = true; notify();
            try {
                const saved = await apply(change);
                if (epoch !== generation) return false;
                remember(saved);
                from.pop(); to.push(copy(forward ? saved : reverse(saved)));
                return true;
            } finally { if (epoch === generation) { busy = false; notify(); } }
        },
    };
}

function reverse(change) {
    const result = copy(change);
    for (const item of commandParts(result)) {
        [item.before, item.after] = [item.after, item.before];
    }
    return result;
}

export function commandParts(change) {
    return [...(change.objects || []), ...(change.tiles || []), ...(change.cells || []), ...(change.darkness || []),
        ...(change.lights ? [change.lights] : []), ...(change.environment ? [change.environment] : [])];
}
