const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');

const root = path.resolve(__dirname, '..');
const clientId = 'test-client.apps.googleusercontent.com';
const stub = `
  const { OAuth2Client } = require('google-auth-library');
  if (process.env.PIXAME_TEST_FAIL_WORLD) {
    const fs = require('node:fs');
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith('world.json')) throw new Error('Simulated world save failure');
      return rename(from, to);
    };
  }
  OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
    if (audience !== process.env.GOOGLE_CLIENT_ID || idToken !== 'valid-test-token') throw new Error('Invalid token');
    return { getPayload: () => ({ sub: 'test-google-subject' }) };
  };
  require('./server.js');
`;

async function unusedPort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(directory, port, extraEnv = {}) {
  const child = spawn(process.execPath, ['-e', stub], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PIXAME_SAVE_DIRECTORY: directory, GOOGLE_CLIENT_ID: clientId, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    if (output.includes('Server listening')) return child;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`Test server did not start: ${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

test('room switch barrier reports a failed world save', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-room-failure-test-'));
  const port = await unusedPort();
  const server = await startServer(directory, port, { PIXAME_TEST_FAIL_WORLD: '1' });
  const socket = io(`http://127.0.0.1:${port}`, { autoConnect: false, transports: ['websocket'], query: { room: 'lobby1' } });
  t.after(async () => {
    socket.disconnect();
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  socket.connect();
  await once(socket, 'connect');
  const result = await socket.timeout(3000).emitWithAck('blockEdit', { x: 1, y: 1, z: 1, removed: false, placedType: 'wood' });
  assert.match(result.error, /save/i);
  const barrier = await socket.timeout(3000).emitWithAck('roomSwitchBarrier');
  assert.match(barrier.error, /could not be saved/i);
});

test('Google sign-in verifies identity and retains its separate profile after restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-google-test-'));
  const port = await unusedPort();
  let server = await startServer(directory, port);
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, headers = {}) => fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  });

  assert.deepEqual(await (await fetch(base + '/api/auth/google-config')).json(), { clientId });
  assert.equal((await post('/api/auth/google', {})).status, 400);
  assert.equal((await post('/api/auth/google', { credential: 'invalid' })).status, 401);

  const first = await (await post('/api/auth/google', { credential: 'valid-test-token' })).json();
  assert.equal(first.profile, null);
  assert.equal(first.revision, 0);
  const profile = {
    hotbarItems: [{ type: 'wood', count: 3 }, ...Array(7).fill(null)],
    backpackItems: Array(27).fill(null),
    selectedHotbarIndex: 0,
    position: { x: 1, y: 10, z: 2 }
  };
  const saved = await post('/api/player-profile', profile, {
    Authorization: `Bearer ${first.token}`, 'X-Profile-Revision': '0'
  });
  assert.equal(saved.status, 200);

  const legacy = await post('/api/auth/signup', { username: 'testplayer', password: 'password123' });
  assert.equal(legacy.status, 201);
  assert.equal((await post('/api/auth/login', { username: 'testplayer', password: 'password123' })).status, 200);
  await stopServer(server);
  server = await startServer(directory, port);
  const second = await (await post('/api/auth/google', { credential: 'valid-test-token' })).json();
  assert.deepEqual(second.profile, profile);
  assert.equal(second.revision, 1);
  const session = await fetch(base + '/api/auth/session', { headers: { Authorization: `Bearer ${second.token}` } });
  assert.equal(session.status, 200);
  assert.deepEqual((await session.json()).profile, profile);
});

test('rooms isolate players, world edits, furnaces and player profiles across restarts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-rooms-test-'));
  const legacyWorld = [{ x: 9, y: 1, z: 9, removed: false, placedType: 'wood' }];
  fs.writeFileSync(path.join(directory, 'world.json'), JSON.stringify(legacyWorld));
  const port = await unusedPort();
  let server = await startServer(directory, port);
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, room, headers = {}) => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pixame-Room': room, ...headers },
    body: JSON.stringify(body)
  });
  const login = await post('/api/auth/google', { credential: 'valid-test-token' }, 'lobby1');
  const { token } = await login.json();
  const auth = { Authorization: `Bearer ${token}` };
  const getSession = room => fetch(base + '/api/auth/session', { headers: { ...auth, 'X-Pixame-Room': room } });
  assert.equal((await getSession('lobby2')).status, 200);
  assert.equal((await (await getSession('lobby2')).json()).profile, null);
  assert.equal((await getSession('not-a-room')).status, 400);
  const profile = count => ({
    hotbarItems: [{ type: 'iron_ore', count }, ...Array(7).fill(null)],
    backpackItems: Array(27).fill(null),
    selectedHotbarIndex: 0,
    position: { x: count, y: 10, z: 2 }
  });
  for (const [room, count] of [['lobby1', 3], ['lobby2', 7]]) {
    const saved = await post('/api/player-profile', profile(count), room, { ...auth, 'X-Profile-Revision': '0' });
    assert.equal(saved.status, 200);
  }
  assert.deepEqual((await (await getSession('lobby1')).json()).profile, profile(3));
  assert.deepEqual((await (await getSession('lobby2')).json()).profile, profile(7));
  assert.equal((await (await getSession('lobby3')).json()).profile, null);

  async function connect(room) {
    const socket = io(base, { autoConnect: false, transports: ['websocket'], query: { room } });
    sockets.push(socket);
    const edits = once(socket, 'worldEdits');
    socket.connect();
    await once(socket, 'connect');
    return { socket, edits: (await edits)[0] };
  }
  const first = await connect('lobby1');
  const peer = await connect('lobby1');
  const second = await connect('lobby2');
  assert.deepEqual(first.edits, []);
  assert.deepEqual(second.edits, []);
  let leakedEdit = false;
  second.socket.on('blockEdit', () => { leakedEdit = true; });
  const observed = once(peer.socket, 'blockEdit');
  const edit = { x: 1, y: 2, z: 3, removed: false, placedType: 'furnace' };
  assert.deepEqual(await first.socket.timeout(3000).emitWithAck('blockEdit', edit), { ok: true });
  assert.deepEqual((await observed)[0], edit);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(leakedEdit, false);
  first.socket.emit('move', { x: 2, y: 3, z: 4 });
  const peerState = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Missing room player state')), 3000);
    peer.socket.on('state', state => {
      if (state[first.socket.id]) {
        clearTimeout(timer);
        resolve(state);
      }
    });
  });
  assert.ok(peerState[first.socket.id]);
  const otherState = (await once(second.socket, 'state'))[0];
  assert.equal(otherState[first.socket.id], undefined);
  assert.deepEqual(await first.socket.timeout(3000).emitWithAck('roomSwitchBarrier'), { ok: true });

  const furnaceAction = { ...edit, action: 'insert', slot: 'input', container: 'hotbarItems', index: 0, profile: profile(3), revision: 1 };
  const inserted = await post('/api/furnace', furnaceAction, 'lobby1', auth);
  assert.equal(inserted.status, 200);
  assert.equal((await inserted.json()).furnace.input.count, 1);
  assert.equal((await post('/api/furnace', { ...edit, action: 'view' }, 'lobby2', auth)).status, 404);
  sockets.forEach(socket => socket.disconnect());
  await stopServer(server);
  server = await startServer(directory, port);
  const relogin = await post('/api/auth/google', { credential: 'valid-test-token' }, 'lobby1');
  const newAuth = { Authorization: `Bearer ${(await relogin.json()).token}` };
  const room1 = await fetch(base + '/api/auth/session', { headers: { ...newAuth, 'X-Pixame-Room': 'lobby1' } });
  const room2 = await fetch(base + '/api/auth/session', { headers: { ...newAuth, 'X-Pixame-Room': 'lobby2' } });
  assert.equal((await room1.json()).profile.hotbarItems[0].count, 2);
  assert.deepEqual((await room2.json()).profile, profile(7));
  const furnace = await post('/api/furnace', { ...edit, action: 'view' }, 'lobby1', newAuth);
  assert.equal((await furnace.json()).furnace.input.count, 1);
  const reconnected = await connect('lobby1');
  assert.deepEqual(reconnected.edits, [edit]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'world.json'), 'utf8')), legacyWorld);
});
