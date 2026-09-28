// Parameters and targets stay on the server; the client only asks to resume an ID.
export function createDeferredActionResumer({ send, resumeConsumable, canResume, notify }) {
    const attempted = new Set();
    const running = new Set();
    return async function resume(state, { force = false } = {}) {
        const actor = state?.current_character;
        const action = actor?.deferred_action;
        const medical = action?.client_executable && action.action_key === 'consumable_use' && resumeConsumable;
        if (state?.status !== 'active' || (!action?.server_executable && !medical) || action.status !== 'ready'
            || !canResume(actor) || running.has(action.id) || (!force && attempted.has(action.id))) return;
        attempted.add(action.id);
        if (attempted.size > 200) attempted.delete(attempted.values().next().value);
        running.add(action.id);
        try {
            if (medical) {
                if (await resumeConsumable(action.id) === false) {
                    // The initiating request may still hold the inventory lock.
                    attempted.delete(action.id);
                    return;
                }
            } else await send({
                location_character_id: actor.location_character_id,
                action_key: action.action_key,
                resume_pending_action_id: action.id,
            });
            notify('Длительное действие завершено', 'success');
        } catch (error) {
            // Another authorized tab may have completed the same action already.
            if (error.status !== 409 || medical) notify(error.message || 'Не удалось завершить длительное действие. Повторите или отмените его в панели боя.', 'system');
        } finally {
            running.delete(action.id);
        }
    };
}
