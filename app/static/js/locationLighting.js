export const DEFAULT_LOCATION_LIGHTING = Object.freeze({
    mode: 'world',
    ambient_color: '#b9c4d0',
    ambient_intensity: 0.55,
    directional_color: '#fff0d5',
    directional_intensity: 1,
    directional_azimuth: 45,
    directional_elevation: 50,
    background_color: '#283642',
    local_lights: [],
    dark_tiles: [],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (start, end, value) => {
    const t = clamp((value - start) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
};
const mixColor = (dark, light, amount) => {
    const from = parseInt(dark.slice(1), 16);
    const to = parseInt(light.slice(1), 16);
    const channels = [16, 8, 0].map(shift => Math.round(
        ((from >> shift) & 255) * (1 - amount) + ((to >> shift) & 255) * amount,
    ));
    return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
};

export function resolveLocationLighting(settings, minutes = 480, clarity = 1) {
    const config = { ...DEFAULT_LOCATION_LIGHTING, ...(settings || {}) };
    if (config.mode === 'manual') return config;
    const time = ((Number(minutes) || 0) % 1440 + 1440) % 1440;
    const day = smoothstep(300, 480, time) * (1 - smoothstep(1080, 1260, time));
    const clouds = clamp(Number(clarity) || 0, 0, 1);
    return {
        ...config,
        ambient_color: mixColor('#9eb5d3', '#e6e0d4', day),
        ambient_intensity: 0.08 + day * (0.4 + 0.15 * clouds),
        directional_color: mixColor('#a6b9d8', '#ffe8c2', day),
        directional_intensity: 0.04 + day * (0.65 + 0.35 * clouds),
        background_color: mixColor('#101b2b', '#8ba3ae', day),
    };
}

export function resolveLocationVisualPreset(profile, preset = 'current', minutes = 480) {
    if (preset !== 'natural_daylight' || profile.mode !== 'world') return profile;
    const time = ((Number(minutes) || 0) % 1440 + 1440) % 1440;
    const day = smoothstep(300, 480, time) * (1 - smoothstep(1080, 1260, time));
    if (!day) return profile;
    return {
        ...profile,
        ambient_color: mixColor(profile.ambient_color, '#cbd5d0', day * 0.55),
        ambient_intensity: Number(profile.ambient_intensity) + day * 0.15,
        directional_color: mixColor(profile.directional_color, '#f5e7d3', day * 0.35),
        directional_intensity: Math.max(0, Number(profile.directional_intensity) - day * 0.12),
    };
}
