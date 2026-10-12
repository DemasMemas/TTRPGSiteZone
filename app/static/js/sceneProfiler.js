function summarize(values) {
    if (!values.length) return { average: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
        average: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    };
}

const LONG_FRAME_MS = 1000;
const MAX_PHASE_MS = 30000;

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
        results.push({ name: phases[phaseIndex].name, valid,
            fps: valid && frame.average ? 1000 / frame.average : null,
            frameMs: frame.average, frameP95Ms: frame.p95, cpuMs: cpu.average,
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
