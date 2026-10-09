export const LOCATION_ASSETS = Object.freeze([
    { id: 'wall', group: 'Постройки', label: 'Стена', icon: '▥', kind: 'structure', color: '#80786c', dimensions: [3, 0.2, 2.4] },
    { id: 'floor', group: 'Постройки', label: 'Пол', icon: '▦', kind: 'structure', color: '#776d5d', dimensions: [2, 2, 0.12] },
    { id: 'door', group: 'Постройки', label: 'Дверь', icon: '▯', kind: 'structure', color: '#75573b', dimensions: [0.9, 0.18, 2] },
    { id: 'window', group: 'Постройки', label: 'Окно', icon: '▧', kind: 'structure', color: '#9bb7bc', elevation: 1, dimensions: [1.2, 0.14, 1] },
    { id: 'fence', group: 'Постройки', label: 'Забор', icon: '╫', kind: 'structure', color: '#67745d', dimensions: [2, 0.15, 1.2] },
    { id: 'table', group: 'Мебель', label: 'Стол', icon: '▤', kind: 'structure', color: '#806044', dimensions: [1.4, 0.8, 1] },
    { id: 'chair', group: 'Мебель', label: 'Стул', icon: '♙', kind: 'structure', color: '#74563d', dimensions: [0.55, 0.55, 1] },
    { id: 'box', group: 'Мебель', label: 'Ящик', icon: '▣', kind: 'structure', color: '#8b6b4f', dimensions: [0.8, 0.8, 0.7] },
    { id: 'barrel', group: 'Мебель', label: 'Бочка', icon: '◉', kind: 'structure', color: '#8a6444', dimensions: [0.65, 0.65, 1] },
    { id: 'shelf', group: 'Мебель', label: 'Стеллаж', icon: '▥', kind: 'structure', color: '#78634c', dimensions: [1.2, 0.4, 2] },
    { id: 'chest', group: 'Мебель', label: 'Сундук', icon: '▣', kind: 'structure', color: '#785238', dimensions: [0.9, 0.6, 0.7] },
    { id: 'tree', group: 'Природа', label: 'Дерево', icon: '♠', kind: 'decor', color: '#2d5a27', dimensions: [0.92, 0.92, 1.72] },
    { id: 'rock', group: 'Природа', label: 'Камень', icon: '◆', kind: 'decor', color: '#888888', dimensions: [0.6, 0.6, 0.6] },
    { id: 'tent', group: 'Природа', label: 'Палатка', icon: '△', kind: 'decor', color: '#d2b48c', dimensions: [1.4, 1.4, 0.6] },
    { id: 'campfire', group: 'Природа', label: 'Костёр', icon: '✦', kind: 'decor', color: '#ff6600', dimensions: [0.6, 0.6, 0.16] },
    { id: 'poster', group: 'Декор', label: 'Постер', icon: '▤', kind: 'decor', color: '#c9a96a', elevation: 1.6, offsetZ: 0.13, rotation: 90, dimensions: [0.8, 0.035, 1.1] },
    { id: 'warm_lamp', group: 'Свет', label: 'Тёплая лампа', icon: '✺', kind: 'lamp', color: '#ffd090', intensity: 2.5, distance: 8, height: 2.2, dimensions: [0.36, 0.36, 0.36] },
    { id: 'cold_lamp', group: 'Свет', label: 'Холодная лампа', icon: '✺', kind: 'lamp', color: '#a9d9ff', intensity: 2.5, distance: 8, height: 2.2, dimensions: [0.36, 0.36, 0.36] },
    { id: 'emergency_lamp', group: 'Свет', label: 'Аварийный свет', icon: '✹', kind: 'lamp', color: '#ff674f', intensity: 2, distance: 6, height: 1.8, dimensions: [0.36, 0.36, 0.36] },
    { id: 'spot_lamp', group: 'Свет', label: 'Прожектор', icon: '◕', kind: 'lamp', lightKind: 'spot', color: '#fff0c8', intensity: 4, distance: 12, height: 2.6, dimensions: [0.4, 0.4, 0.35] },
]);

export function findLocationAsset(id) {
    return LOCATION_ASSETS.find(asset => asset.id === id) || null;
}
