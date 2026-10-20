const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../app/static/js/authSession.js'), 'utf8');

function token(exp) {
    return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
}

function createSession() {
    let now = 1_700_000_000_000;
    const original = token(Math.floor((now + 30 * 60_000) / 1000));
    const renewed = token(Math.floor((now + 56 * 60_000) / 1000));
    const storage = new Map([['access_token', original]]);
    const listeners = new Map();
    const calls = [];
    const localStorage = {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
    };
    const document = {
        visibilityState: 'visible',
        addEventListener: (name, callback) => listeners.set(name, callback),
    };
    const window = {
        location: { href: 'http://localhost/lobby', origin: 'http://localhost' },
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (url === '/auth/refresh') {
                return { ok: true, status: 200, json: async () => ({ access_token: renewed }) };
            }
            return { ok: true, status: 200 };
        },
    };
    class Clock extends Date {
        static now() { return now; }
    }
    const context = vm.createContext({
        window, document, localStorage, Headers, URL, Date: Clock,
        atob: value => Buffer.from(value, 'base64').toString('utf8'),
    });
    vm.runInContext(script, context);
    return { window, document, listeners, calls, original, renewed,
        setTime: value => { now = value; }, now: () => now, context };
}

test('active session renews once and replaces stale HTTP bearer tokens', async () => {
    const session = createSession();
    const headers = { Authorization: `Bearer ${session.original}` };
    await session.window.fetch('/lobbies/', { headers });
    assert.equal(session.calls.filter(call => call.url === '/auth/refresh').length, 0);

    session.setTime(session.now() + 26 * 60_000);
    session.listeners.get('keydown')();
    await Promise.all([
        session.window.fetch('/lobbies/a', { headers }),
        session.window.fetch('/lobbies/b', { headers }),
    ]);
    assert.equal(session.calls.filter(call => call.url === '/auth/refresh').length, 1);
    for (const call of session.calls.filter(call => /^\/lobbies\/[ab]$/.test(call.url))) {
        assert.equal(call.options.headers.get('Authorization'), `Bearer ${session.renewed}`);
    }
});

test('idle, hidden and expired sessions do not renew', async () => {
    const session = createSession();
    session.setTime(session.now() + 26 * 60_000);
    await session.window.authSession.refreshIfNeeded();
    assert.equal(session.calls.length, 0);

    session.document.visibilityState = 'hidden';
    session.listeners.get('keydown')();
    await session.window.authSession.refreshIfNeeded();
    assert.equal(session.calls.length, 0);

    session.document.visibilityState = 'visible';
    session.setTime(session.now() + 5 * 60_000);
    await session.window.authSession.refreshIfNeeded();
    assert.equal(session.calls.length, 0);
    assert.equal(session.window.authSession.isExpired(), true);
});

test('Socket.IO sends the current token rather than a module-cached token', () => {
    const session = createSession();
    const socketSource = fs.readFileSync(
        path.join(__dirname, '../app/static/js/socketHandlers.js'), 'utf8'
    );
    const start = socketSource.indexOf('export function initSocket(');
    const end = socketSource.indexOf("socket.on('connect'", start);
    assert.ok(start >= 0 && end > start);
    const emitted = [];
    const socket = { emit: (...args) => emitted.push(args) };
    session.context.io = () => socket;
    session.context.currentLobbyId = null;
    session.context.socket = null;
    vm.runInContext(socketSource.slice(start, end).replace('export function', 'function') + '}',
        session.context);
    session.context.initSocket(1, session.original);
    session.context.localStorage.setItem('access_token', session.renewed);
    socket.emit('test', { token: session.original, id: 42 });
    assert.equal(emitted[0][1].token, session.renewed);
    assert.equal(emitted[0][1].id, 42);
});
