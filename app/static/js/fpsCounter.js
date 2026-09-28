export function createFpsCounter(container, label) {
    const badge = document.createElement('div');
    badge.className = 'scene-fps-counter';
    badge.setAttribute('aria-label', `${label}: частота кадров`);
    const caption = document.createElement('span');
    caption.textContent = `${label} · FPS`;
    const value = document.createElement('strong');
    value.textContent = '—';
    badge.append(caption, value);
    container.appendChild(badge);

    let startedAt = null;
    let previousFrameAt = null;
    let frames = 0;

    function pause() {
        if (startedAt === null) return;
        startedAt = null;
        previousFrameAt = null;
        frames = 0;
        value.textContent = '—';
        badge.removeAttribute('data-fps-level');
    }

    function frame(now) {
        if (document.hidden) {
            pause();
            return;
        }
        if (startedAt === null || now - previousFrameAt > 2000) {
            startedAt = now;
            previousFrameAt = now;
            frames = 0;
            value.textContent = '—';
            badge.removeAttribute('data-fps-level');
            return;
        }
        previousFrameAt = now;
        frames += 1;
        const elapsed = now - startedAt;
        if (elapsed < 1000) return;
        const fps = Math.round(frames * 1000 / elapsed);
        value.textContent = String(fps);
        badge.dataset.fpsLevel = fps < 30 ? 'low' : (fps < 50 ? 'medium' : 'high');
        startedAt = now;
        frames = 0;
    }

    document.addEventListener('visibilitychange', pause);
    return {
        frame,
        pause,
        destroy() {
            document.removeEventListener('visibilitychange', pause);
            badge.remove();
        },
    };
}
