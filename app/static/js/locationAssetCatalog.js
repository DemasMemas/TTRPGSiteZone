export const LOCATION_ASSETS = Object.freeze([
    { id: 'wall', group: 'Постройки', label: 'Стена', icon: '▥', kind: 'structure', color: '#80786c', dimensions: [3, 0.2, 2.4] },
    { id: 'floor', group: 'Постройки', label: 'Пол', icon: '▦', kind: 'structure', color: '#776d5d', dimensions: [2, 2, 0.12] },
    { id: 'door', group: 'Постройки', label: 'Дверь', icon: '▯', kind: 'structure', color: '#75573b', dimensions: [0.9, 0.18, 2] },
    { id: 'window', group: 'Постройки', label: 'Окно', icon: '▧', kind: 'structure', color: '#9bb7bc', elevation: 1, dimensions: [1.2, 0.14, 1] },
    { id: 'fence', group: 'Постройки', label: 'Забор', icon: '╫', kind: 'structure', color: '#8b7458', dimensions: [2, 0.15, 1.2] },
    { id: 'table', group: 'Мебель', label: 'Стол', icon: '▤', kind: 'structure', color: '#806044', dimensions: [1.4, 0.8, 1] },
    { id: 'chair', group: 'Мебель', label: 'Стул', icon: '♙', kind: 'structure', color: '#74563d', dimensions: [0.55, 0.55, 1] },
    { id: 'box', group: 'Мебель', label: 'Ящик', icon: '▣', kind: 'structure', color: '#8b6b4f', dimensions: [0.8, 0.8, 0.7] },
    { id: 'military_crate', group: 'Мебель', label: 'Военный ящик', icon: '▣', kind: 'structure', color: '#45543a', dimensions: [1.1, 0.8, 0.65] },
    { id: 'barrel', group: 'Мебель', label: 'Бочка', icon: '◉', kind: 'structure', color: '#8a6444', dimensions: [0.65, 0.65, 1] },
    { id: 'shelf', group: 'Мебель', label: 'Стеллаж', icon: '▥', kind: 'structure', color: '#78634c', dimensions: [1.2, 0.4, 2] },
    { id: 'tree', group: 'Природа', label: 'Дерево', icon: '♠', kind: 'decor', color: '#2d5a27', dimensions: [0.92, 0.92, 1.72] },
    { id: 'rock', group: 'Природа', label: 'Камень', icon: '◆', kind: 'decor', color: '#888888', dimensions: [0.6, 0.6, 0.6] },
    { id: 'tent', group: 'Природа', label: 'Палатка', icon: '△', kind: 'decor', color: '#9b9778', dimensions: [1.8, 1.2, 1.3] },
    { id: 'campfire', group: 'Огонь', label: 'Костёр', icon: '✦', kind: 'structure', color: '#74604b', dimensions: [0.9, 0.9, 0.7] },
    { id: 'torch', group: 'Огонь', label: 'Факел', icon: '♨', kind: 'structure', color: '#6b4a30', dimensions: [0.25, 0.25, 1.7] },
    { id: 'wall_torch', group: 'Огонь', label: 'Настенный факел', icon: '♨', kind: 'structure', color: '#6b4a30', elevation: 1.25, offsetZ: -0.43, dimensions: [0.28, 0.42, 0.75] },
    { id: 'fire_barrel', group: 'Огонь', label: 'Бочка с огнём', icon: '◉', kind: 'structure', color: '#5f625c', dimensions: [0.72, 0.72, 0.78] },
    { id: 'ceiling_bulb', group: 'Свет', label: 'Потолочная лампочка', icon: '✺', kind: 'structure', color: '#ffe2aa', elevation: 2.4, dimensions: [0.32, 0.32, 0.7] },
    { id: 'wall_bulb', group: 'Свет', label: 'Настенная лампочка', icon: '✺', kind: 'structure', color: '#ffe2aa', elevation: 1.8, offsetZ: -0.43, dimensions: [0.38, 0.4, 0.36] },
    { id: 'poster', group: 'Декор', label: 'Постер', icon: '▤', kind: 'decor', color: '#c9a96a', elevation: 1.6, offsetZ: 0.13, rotation: 90, dimensions: [0.8, 0.035, 1.1] },
    { id: 'warm_lamp', group: 'Свет', label: 'Тёплая лампа', icon: '✺', kind: 'lamp', color: '#ffd090', intensity: 2.5, distance: 8, height: 2.2, dimensions: [0.36, 0.36, 0.36] },
    { id: 'cold_lamp', group: 'Свет', label: 'Холодная лампа', icon: '✺', kind: 'lamp', color: '#a9d9ff', intensity: 2.5, distance: 8, height: 2.2, dimensions: [0.36, 0.36, 0.36] },
    { id: 'emergency_lamp', group: 'Свет', label: 'Аварийный свет', icon: '✹', kind: 'lamp', color: '#ff674f', intensity: 2, distance: 6, height: 1.8, dimensions: [0.36, 0.36, 0.36] },
    { id: 'spot_lamp', group: 'Свет', label: 'Прожектор', icon: '◕', kind: 'lamp', lightKind: 'spot', color: '#fff0c8', intensity: 4, distance: 12, height: 2.6, dimensions: [0.4, 0.4, 0.35] },
]);

export function findLocationAsset(id) {
    return LOCATION_ASSETS.find(asset => asset.id === id) || null;
}
