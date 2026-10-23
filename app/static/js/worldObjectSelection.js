export function objectFromWorldInstance(entry, type, instanceId, indices) {
    for (let tileIndex = 0; tileIndex < indices.length; tileIndex++) {
        const ordinal = indices[tileIndex]?.indexOf(instanceId) ?? -1;
        if (ordinal < 0) continue;
        const size = entry.tilesData.length;
        const tileX = tileIndex % size;
        const tileY = Math.floor(tileIndex / size);
        const objects = entry.tilesData[tileY][tileX].objects || [];
        let seen = 0;
        const index = objects.findIndex(object => object.type === type && seen++ === ordinal);
        if (index >= 0) return { chunkX: entry.chunkX, chunkY: entry.chunkY, tileX, tileY, index };
    }
    return null;
}

export function worldObjectDragTarget(point, grabOffset, width, height) {
    const x = point.x + grabOffset.x;
    const z = point.z + grabOffset.z;
    if (x < 0 || z < 0 || x >= width || z >= height) return null;
    const tileX = Math.floor(x);
    const tileY = Math.floor(z);
    return { tile_x: tileX, tile_y: tileY, x: x - tileX - 0.5, z: z - tileY - 0.5 };
}

export function worldObjectMouseTransform(kind, object, deltaX) {
    if (kind === 'scale') {
        return { scale: Math.max(0.2, Math.min(2,
            Number(((object.scale ?? 1) + Math.round(deltaX) * 0.01).toFixed(10)))) };
    }
    // Positive Three.js yaw is counterclockwise when viewed from above.
    const angle = (object.rotation ?? 0) - Math.round(deltaX * 0.5);
    return { rotation: Math.min(359, ((angle % 360) + 360) % 360) };
}

export function createWorldObjectSelection({ getTile, editObject, applyUpdate, onChange, onError, equal }) {
    let selected = null;
    let busy = false;
    const snapshot = object => JSON.parse(JSON.stringify(object));
    const same = equal;
    const clear = () => { selected = null; onChange(null, busy); };
    const select = reference => {
        if (busy) return;
        const object = reference && getTile(reference)?.objects?.[reference.index];
        selected = object ? { ...reference, object: snapshot(object) } : null;
        onChange(selected, busy);
    };
    const validate = () => {
        if (selected && !same(getTile(selected)?.objects?.[selected.index], selected.object)) {
            clear();
            onError('Объект изменён другим участником. Выберите его снова.');
            return false;
        }
        return Boolean(selected);
    };
    const commit = async (changes = {}, target = null, remove = false) => {
        if (busy || !validate()) return false;
        const original = selected;
        const source = { tile_x: original.chunkX * 32 + original.tileX,
            tile_y: original.chunkY * 32 + original.tileY, index: original.index };
        target ||= { tile_x: source.tile_x, tile_y: source.tile_y };
        changes = Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
            !same(value, original.object[key] ?? ({ x: 0, z: 0, scale: 1, rotation: 0 }[key]))));
        if (!remove && !Object.keys(changes).length && source.tile_x === target.tile_x && source.tile_y === target.tile_y) {
            onChange(selected, false);
            return true;
        }
        busy = true;
        onChange(selected, busy);
        try {
            const result = await editObject({ source, target, changes, expected: original.object,
                ...(remove ? { delete: true } : {}) });
            for (const update of result.updates) applyUpdate(update);
            // A tool switch during the request must not restore the selection.
            if (selected === original) {
                selected = remove ? null : {
                    chunkX: Math.floor(target.tile_x / 32), chunkY: Math.floor(target.tile_y / 32),
                    tileX: target.tile_x % 32, tileY: target.tile_y % 32, index: result.index,
                };
                const object = selected && getTile(selected)?.objects?.[selected.index];
                selected = object ? { ...selected, object: snapshot(object) } : null;
            }
            return true;
        } catch (error) {
            clear();
            onError(error.message);
            return false;
        } finally {
            busy = false;
            onChange(selected, busy);
        }
    };
    return { select, clear, commit, validate,
        get selected() { return selected; }, get busy() { return busy; } };
}
