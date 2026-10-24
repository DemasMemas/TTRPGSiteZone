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

// Reuse the primary object's transform as a group pivot. A single ratio is
// clamped for the entire group so relative sizes and distances stay intact.
export function worldObjectGroupTransform(members, changes = {}, target = null, width = Infinity, height = Infinity) {
    if (!members.length) return null;
    const first = members[0], base = first.object;
    const position = member => ({ x: member.chunkX * 32 + member.tileX + 0.5 + (member.object.x || 0), z: member.chunkY * 32 + member.tileY + 0.5 + (member.object.z || 0) });
    const pivot = position(first);
    let ratio = changes.scale === undefined ? 1 : changes.scale / (base.scale ?? 1);
    ratio = Math.max(...members.map(member => 0.2 / (member.object.scale ?? 1)),
        Math.min(ratio, ...members.map(member => 2 / (member.object.scale ?? 1))));
    const angle = changes.rotation === undefined ? 0 : changes.rotation - (base.rotation || 0);
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    const destination = target ? { x: target.tile_x + 0.5 + (changes.x ?? base.x ?? 0), z: target.tile_y + 0.5 + (changes.z ?? base.z ?? 0) }
        : { x: pivot.x + (changes.x === undefined ? 0 : changes.x - (base.x || 0)), z: pivot.z + (changes.z === undefined ? 0 : changes.z - (base.z || 0)) };
    const plans = members.map(member => {
        const object = member.object, current = position(member);
        const dx = (current.x - pivot.x) * ratio, dz = (current.z - pivot.z) * ratio;
        const moved = ratio !== 1 || angle !== 0 || destination.x !== pivot.x || destination.z !== pivot.z;
        const x = moved ? destination.x + dx * cos + dz * sin : current.x;
        const z = moved ? destination.z - dx * sin + dz * cos : current.z;
        if (x < 0 || z < 0 || x >= width || z >= height) return null;
        const tileX = moved ? Math.floor(x) : member.chunkX * 32 + member.tileX;
        const tileY = moved ? Math.floor(z) : member.chunkY * 32 + member.tileY;
        const own = { ...changes };
        if (changes.scale !== undefined) own.scale = Number(((object.scale ?? 1) * ratio).toFixed(10));
        if (changes.rotation !== undefined) own.rotation = Number(((((object.rotation || 0) + angle) % 360 + 360) % 360).toFixed(10)) % 360;
        if (moved) { own.x = Number((x - tileX - 0.5).toFixed(10)); own.z = Number((z - tileY - 0.5).toFixed(10)); }
        return { reference: member, changes: own, target: { tile_x: tileX, tile_y: tileY } };
    });
    return plans.every(Boolean) ? plans : null;
}

export function createWorldObjectSelection({ getTile, editObject, applyUpdate, onChange, onError, equal, getBounds = () => [Infinity, Infinity] }) {
    let members = [], busy = false;
    const snapshot = object => JSON.parse(JSON.stringify(object));
    const same = equal;
    const notify = () => onChange(members[0] || null, busy);
    const clear = () => { members = []; notify(); };
    const sameReference = (a, b) => ['chunkX', 'chunkY', 'tileX', 'tileY', 'index'].every(key => a[key] === b[key]);
    const select = (reference, { toggle = false, preserve = false } = {}) => {
        if (busy) return;
        const object = reference && getTile(reference)?.objects?.[reference.index];
        const existing = reference ? members.findIndex(member => sameReference(member, reference)) : -1;
        if (toggle) {
            if (!object) return;
            members = existing >= 0 ? members.filter((_, index) => index !== existing) : [...members, { ...reference, object: snapshot(object) }];
        } else if (!(preserve && existing >= 0)) members = object ? [{ ...reference, object: snapshot(object) }] : [];
        notify();
    };
    const validate = () => {
        if (members.some(member => !same(getTile(member)?.objects?.[member.index], member.object))) {
            clear(); onError('Объект изменён другим участником. Выберите его снова.'); return false;
        }
        return Boolean(members.length);
    };
    const plan = (changes = {}, target = null) => worldObjectGroupTransform(members, changes, target, ...getBounds());
    const commit = async (changes = {}, target = null, remove = false) => {
        if (busy || !validate()) return false;
        const original = members;
        const plans = plan(changes, target);
        if (!plans) { onError('Группа выходит за границы карты'); notify(); return false; }
        const edits = plans.map(({ reference: member, changes: own, target: destination }) => ({
            source: { tile_x: member.chunkX * 32 + member.tileX, tile_y: member.chunkY * 32 + member.tileY, index: member.index },
            target: destination,
            changes: Object.fromEntries(Object.entries(own).filter(([key, value]) => !same(value, member.object[key] ?? ({ x: 0, z: 0, scale: 1, rotation: 0 }[key])))),
            expected: member.object, ...(remove ? { delete: true } : {}),
        }));
        if (!remove && edits.every(edit => !Object.keys(edit.changes).length && edit.source.tile_x === edit.target.tile_x && edit.source.tile_y === edit.target.tile_y)) { notify(); return true; }
        busy = true; notify();
        try {
            const result = await editObject(edits.length === 1 ? edits[0] : { edits });
            for (const update of result.updates) applyUpdate(update);
            if (members === original) {
                const locations = result.objects || [{ ...plans[0].target, index: result.index }];
                members = remove ? [] : locations.flatMap(location => {
                    const reference = { chunkX: Math.floor(location.tile_x / 32), chunkY: Math.floor(location.tile_y / 32), tileX: location.tile_x % 32, tileY: location.tile_y % 32, index: location.index };
                    const object = getTile(reference)?.objects?.[reference.index];
                    return object ? [{ ...reference, object: snapshot(object) }] : [];
                });
            }
            return true;
        } catch (error) { clear(); onError(error.message); return false; }
        finally { busy = false; notify(); }
    };
    const selectMany = references => {
        if(busy)return;
        members=references.flatMap(reference=>{
            const object=getTile(reference)?.objects?.[reference.index];
            return object?[{...reference,object:snapshot(object)}]:[];
        });
        notify();
    };
    return { select, selectMany, clear, commit, validate, plan,
        get selected() { return members[0] || null; }, get members() { return members; }, get busy() { return busy; } };
}
