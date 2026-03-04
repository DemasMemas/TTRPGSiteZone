// static/js/state.js

// Начальное состояние приложения
const AppState = {
    // Режимы редактирования карты (из mapEdit.js)
    editMode: false,
    eraserMode: false,
    currentTileType: 'grass',
    brushRadius: 0,
    tileHeight: 1.0,

    // Данные лобби (из ui.js)
    isGM: false,
    lobbyId: null,
    token: localStorage.getItem('access_token') || null,

    // UI-состояния
    settingsVisible: false,
    participantsPanelCollapsed: false,

    // Методы для изменения состояния
    setEditMode(value) {
        this.editMode = value;
    },
    setEraserMode(value) {
        this.eraserMode = value;
        window.eraserMode = value;
    },
    setCurrentTileType(value) {
        this.currentTileType = value;
        window.currentTileType = value;
    },
    setBrushRadius(value) {
        this.brushRadius = value;
        window.brushRadius = value;
    },
    setTileHeight(value) {
        this.tileHeight = value;
        window.tileHeight = value;
    },
    setIsGM(value) {
        this.isGM = value;
    },
    setLobbyId(value) {
        this.lobbyId = value;
    },
    setSettingsVisible(value) {
        this.settingsVisible = value;
    },
    setParticipantsPanelCollapsed(value) {
        this.participantsPanelCollapsed = value;
    }
};

export default AppState;

window.currentTileType = AppState.currentTileType;
window.tileHeight = AppState.tileHeight;
window.brushRadius = AppState.brushRadius;
window.eraserMode = AppState.eraserMode;