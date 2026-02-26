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
        if (response.ok) {
            localStorage.setItem('access_token', data.access_token);
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

    await loadCharacters();
}

// Загрузить список персонажей
async function loadCharacters() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
        const response = await fetch('/characters/', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) {
            logout();
            return;
        }
        const characters = await response.json();
        const list = document.getElementById('characters-list');
        list.innerHTML = '';
        characters.forEach(char => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${char.name}</strong> (ID: ${char.id})<br>Данные: <pre>${JSON.stringify(char.data, null, 2)}</pre>`;
            list.appendChild(li);
        });
    } catch (error) {
        console.error('Ошибка загрузки персонажей', error);
    }
}

// Создать персонажа
async function createCharacter() {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const name = document.getElementById('char-name').value;
    let data = {};
    try {
        data = JSON.parse(document.getElementById('char-data').value);
    } catch (e) {
        alert('Некорректный JSON в поле данных');
        return;
    }

    if (!name) {
        alert('Введите имя персонажа');
        return;
    }

    try {
        const response = await fetch('/characters/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, data })
        });
        if (response.ok) {
            document.getElementById('char-name').value = '';
            document.getElementById('char-data').value = '{ "class": "warrior", "level": 1 }';
            await loadCharacters();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка создания');
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