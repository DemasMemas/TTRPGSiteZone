function summarize(values) {
    if (!values.length) return { average: 0, p95: 0, p99: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
        p99: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)],
    };
}

const LONG_FRAME_MS = 1000;
const MAX_PHASE_MS = 30000;

const pointerMetricKeys = [
    'pointerEvents', 'canvasMouseEvents', 'tileHits', 'editorEvents', 'domWrites',
    'highlightUpdates', 'raycastCalls', 'raycastCandidates', 'raycastMs',
    'surfaceRaycasts', 'surfaceCandidates', 'surfaceMs',
    'characterRaycasts', 'characterCandidates', 'characterMs',
    'structureRaycasts', 'structureCandidates', 'structureMs',
    'editorRaycasts', 'editorCandidates', 'editorMs',
    'pointerHandlerMs', 'characterHandlerMs', 'domMs', 'highlightMs',
];

function emptyPointerMetrics() {
    const metrics = {};
    for (const key of pointerMetricKeys) metrics[key] = 0;
    return metrics;
}

export function createPointerProfile(now = () => performance.now()) {
    let current = emptyPointerMetrics();
    return {
        count(key) { current[key]++; },
        addDuration(key, elapsed) { current[key] += elapsed; },
        measure(key, run) {
            const started = now();
            try { return run(); }
            finally { current[key] += now() - started; }
        },
        raycast(kind, candidates, run) {
            const started = now();
            try { return run(); }
            finally {
                const elapsed = now() - started;
                current.raycastCalls++;
                current.raycastCandidates += candidates.length;
                current.raycastMs += elapsed;
                current[`${kind}Raycasts`]++;
                current[`${kind}Candidates`] += candidates.length;
                current[`${kind}Ms`] += elapsed;
            }
        },
        drain() {
            const result = current;
            current = emptyPointerMetrics();
            return result;
        },
    };
}

export async function copySceneProfileReport(report, clipboard, documentRef) {
    if (!report) return false;
    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(report);
            return true;
        } catch { /* Clipboard API may be unavailable on LAN HTTP. */ }
    }
    if (!documentRef?.execCommand) return false;
    const input = documentRef.createElement('textarea');
    input.value = report;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    documentRef.body.appendChild(input);
    input.select();
    try { return documentRef.execCommand('copy'); }
    catch { return false; }
    finally { input.remove(); }
}

export function createSceneProfiler({ phases, onProgress, onComplete,
    warmupMs = 1000, sampleMs = 3000, minFrames = 20 }) {
    let phaseIndex = -1;
    let phaseStartedAt = 0;
    let firstFrameAt = null;
    let sampleStartedAt = null;
    let previousAt = null;
    let samples = [];
    let results = [];
    let longFrames = 0;
    let longestFrameMs = 0;

    function stop() {
        if (phaseIndex < 0) return;
        phases[phaseIndex].restore();
        phaseIndex = -1;
        firstFrameAt = null;
        sampleStartedAt = null;
        previousAt = null;
        samples = [];
    }

    function enter(index, now) {
        phaseIndex = index;
        phaseStartedAt = now;
        firstFrameAt = null;
        sampleStartedAt = null;
        previousAt = null;
        samples = [];
        longFrames = 0;
        longestFrameMs = 0;
        phases[index].apply();
        onProgress?.(phases[index].name, index + 1, phases.length);
    }

    function complete(now, valid) {
        const frame = summarize(samples.map(sample => sample.frameMs));
        const cpu = summarize(samples.map(sample => sample.cpuMs));
        const calls = summarize(samples.map(sample => sample.calls));
        const triangles = summarize(samples.map(sample => sample.triangles));
        const sceneUpdate = summarize(samples.map(sample => sample.sceneUpdateMs || 0));
        const roofVisibility = summarize(samples.map(sample => sample.roofVisibilityMs || 0));
        const renderSubmit = summarize(samples.map(sample => sample.renderSubmitMs || 0));
        const labels = summarize(samples.map(sample => sample.labelsMs || 0));
        const movingFrameShare = samples.length
            ? samples.filter(sample => sample.cameraMoved).length / samples.length : 0;
        const pointer = emptyPointerMetrics();
        for (const sample of samples) {
            for (const key of pointerMetricKeys) pointer[key] += sample.pointer?.[key] || 0;
        }
        results.push({ name: phases[phaseIndex].name, valid,
            fps: valid && frame.average ? 1000 / frame.average : null,
            frameMs: frame.average, frameP95Ms: frame.p95, frameP99Ms: frame.p99,
            cpuMs: cpu.average, sceneUpdateMs: sceneUpdate.average,
            roofVisibilityMs: roofVisibility.average, renderSubmitMs: renderSubmit.average,
            labelsMs: labels.average, movingFrameShare, pointer,
            calls: calls.average, triangles: triangles.average, frames: samples.length,
            longFrames, longestFrameMs });
        phases[phaseIndex].restore();
        if (phaseIndex + 1 < phases.length) enter(phaseIndex + 1, now);
        else {
            const completed = results;
            phaseIndex = -1;
            previousAt = null;
            onComplete?.(completed);
        }
    }

    return {
        get running() { return phaseIndex >= 0; },
        start(now) {
            stop();
            results = [];
            if (phases.length) enter(0, now);
        },
        stop,
        frame(now, metrics) {
            if (phaseIndex < 0) return;
            const elapsed = previousAt === null ? 0 : now - previousAt;
            previousAt = now;
            if (metrics.cpuMs > LONG_FRAME_MS || elapsed > LONG_FRAME_MS) {
                longFrames += 1;
                longestFrameMs = Math.max(longestFrameMs, metrics.cpuMs, elapsed);
                firstFrameAt = now;
                sampleStartedAt = null;
                samples = [];
                if (now - phaseStartedAt >= MAX_PHASE_MS) complete(now, false);
                return;
            }
            if (firstFrameAt === null) {
                firstFrameAt = now;
                return;
            }
            if (sampleStartedAt === null) {
                if (now - firstFrameAt >= warmupMs) sampleStartedAt = now;
                return;
            }
            samples.push({ ...metrics, frameMs: elapsed });
            if (now - sampleStartedAt >= sampleMs && samples.length >= minFrames) {
                complete(now, true);
            } else if (now - phaseStartedAt >= MAX_PHASE_MS) {
                complete(now, false);
            }
        },
    };
}
