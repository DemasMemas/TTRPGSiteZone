export function createSecondaryDragGuard({ threshold = 3, holdMs = 350, now = Date.now } = {}) {
    let active = null;
    let suppressUntil = 0;

    return {
        begin(x, y, pointerId = null) {
            suppressUntil = 0;
            active = { x, y, pointerId, moved: false, consumed: false };
        },
        move(x, y, pointerId = null) {
            if (active?.pointerId !== pointerId) return;
            if (active && Math.hypot(x - active.x, y - active.y) >= threshold) active.moved = true;
        },
        end() {
            if (active?.moved && !active.consumed) suppressUntil = now() + holdMs;
            active = null;
        },
        shouldSuppressMenu() {
            if (active?.moved) {
                active.consumed = true;
                return true;
            }
            if (suppressUntil && now() <= suppressUntil) {
                suppressUntil = 0;
                return true;
            }
            return false;
        },
        reset() {
            active = null;
            suppressUntil = 0;
        },
    };
}
