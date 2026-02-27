// static/app.js

const API_BASE = ''; // пусто, так как API и фронтенд на одном сервере

// Функция для показа сообщений
function showMessage(text, isError = true) {
    const msgDiv = document.getElementById('auth-message');
    msgDiv.textContent = text;
    msgDiv.className = isError ? 'error' : 'success';
}

// Регистрация
async function register() {
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    if (!username || !email || !password) {
        showMessage('Заполните все поля');
        return;
    }

    try {
        const response = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await response.json();
        if (response.ok) {
            showMessage('Регистрация успешна! Теперь войдите.', false);
        } else {
            showMessage(data.error || 'Ошибка регистрации');
        }
    } catch (error) {
        showMessage('Ошибка сети');
    }
}

// Логин
async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showMessage('Введите имя и пароль');
        return;
    }

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        console.log('login response:', response.status, data); // <-- добавить
        if (response.ok) {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('username', username);
            showMessage('Вход выполнен', false);
            loadApp();
        } else {
            showMessage(data.error || 'Ошибка входа');
        }
    } catch (error) {
        showMessage('Ошибка сети');
    }
}

// Выход
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('username');
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('app-section').classList.add('hidden');
    showMessage('');
}

// Загрузить основное приложение после входа
async function loadApp() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        logout();
        return;
    }

    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('app-section').classList.remove('hidden');
    document.getElementById('username').textContent = localStorage.getItem('username') || '';

    await loadMyLobbies();
}

async function createLobby() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const name = document.getElementById('lobby-name').value;
    const mapType = document.getElementById('map-type').value;
    if (!name) {
        alert('Введите название лобби');
        return;
    }

    try {
        const response = await fetch('/lobbies/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, map_type: mapType })
        });
        if (response.ok) {
            const lobby = await response.json();
            console.log('Lobby created:', lobby);
            window.location.href = `/lobbies/${lobby.id}/page`;
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка создания лобби');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

async function joinByCode() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const code = document.getElementById('invite-code').value.trim().toUpperCase();
    if (!code) {
        alert('Введите код');
        return;
    }

    try {
        const response = await fetch('/lobbies/join_by_code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ code })
        });
        if (response.ok) {
            const data = await response.json();
            window.location.href = `/lobbies/${data.lobby_id}/page`;
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка присоединения');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

async function loadMyLobbies() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const response = await fetch('/lobbies/my', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 422) {
            logout();
            return;
        }
        const lobbies = await response.json();
        const container = document.getElementById('my-lobbies-list');
        container.innerHTML = '';
        if (lobbies.length === 0) {
            container.innerHTML = '<p>У вас пока нет созданных лобби</p>';
            return;
        }
        lobbies.forEach(lobby => {
            const div = document.createElement('div');
            div.className = 'lobby-item';
            div.innerHTML = `
                <strong>${lobby.name}</strong> (код: ${lobby.invite_code})
                <div>
                    <button onclick="joinLobby(${lobby.id})">Войти</button>
                    <button class="delete-btn" onclick="deleteLobby(${lobby.id})">🗑️ Удалить</button>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (error) {
        console.error('Ошибка загрузки моих лобби', error);
    }
}

async function deleteLobby(lobbyId) {
    if (!confirm('Вы уверены, что хотите удалить лобби? Это действие необратимо.')) return;

    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const response = await fetch(`/lobbies/${lobbyId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            alert('Лобби удалено');
            loadMyLobbies(); // обновляем список
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка при удалении');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

async function joinLobby(lobbyId) {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const response = await fetch(`/lobbies/${lobbyId}/join`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            window.location.href = `/lobbies/${lobbyId}/page`;
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка присоединения');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

// Проверим, есть ли уже токен при загрузке страницы
window.onload = () => {
    if (localStorage.getItem('access_token')) {
        loadApp();
    }
};