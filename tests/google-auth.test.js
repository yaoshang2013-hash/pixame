const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
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
    if (audience !== process.env.GOOGLE_CLIENT_ID || !['valid-test-token', 'admin-token', 'unverified-token'].includes(idToken)) throw new Error('Invalid token');
    const sub = idToken === 'valid-test-token' ? 'test-google-subject' : idToken;
    return { getPayload: () => ({ sub, email: 'admin@example.test', email_verified: idToken === 'admin-token' }) };
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
  for (let attempt = 0; attempt < 300; attempt++) {
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

test('creative palette adds blocks only for an administrator', () => {
  const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const start = source.indexOf('        function addPaletteBlock(');
  const end = source.indexOf('        const adminItemSelect', start);
  assert.ok(start !== -1 && end !== -1);
  const context = vm.createContext({
    isPlayerAdmin: false, placeableBlockTypes: new Set(['stone']),
    hotbarItems: Array(8).fill(null), selectedHotbarIndex: 0,
    updateHotbar() {}, showItemNotification() {}, setBlockPaletteOpen() {}
  });
  vm.runInContext(source.slice(start, end), context);
  context.addPaletteBlock('stone');
  assert.equal(context.hotbarItems[0], null);
  context.isPlayerAdmin = true;
  context.addPaletteBlock('stone');
  assert.equal(context.hotbarItems[0].type, 'stone');
  assert.equal(context.hotbarItems[0].count, 64);
});

test('room switch barrier reports a failed world save', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-room-failure-test-'));
  const port = await unusedPort();
  const server = await startServer(directory, port, { PIXAME_TEST_FAIL_WORLD: '1' });
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + '/api/auth/google', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'valid-test-token' })
  });
  const { token } = await login.json();
  const socket = io(base, { autoConnect: false, transports: ['websocket'], query: { room: 'lobby1' }, auth: { token }, timeout: 3000 });
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

test('admin privileges require a Google-verified configured identity', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-admin-test-'));
  const port = await unusedPort();
  const server = await startServer(directory, port, { PIXAME_ADMIN_GOOGLE_EMAIL: 'admin@example.test' });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const login = async credential => {
    const response = await fetch(base + '/api/auth/google', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential })
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const ordinary = await login('unverified-token');
  assert.equal(ordinary.isAdmin, false);
  const admin = await login('admin-token');
  assert.equal(admin.isAdmin, true);
  const session = await fetch(base + '/api/auth/session', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal((await session.json()).isAdmin, true);
});

test('admin moderation and room archive are authorized and preserve saves', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-moderation-test-'));
  const port = await unusedPort();
  let server = await startServer(directory, port, { PIXAME_ADMIN_GOOGLE_EMAIL: 'admin@example.test' });
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, token, room = 'lobby1') => fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pixame-Room': room, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const googleLogin = async credential => (await post('/api/auth/google', { credential })).json();
  let admin = await googleLogin('admin-token');
  const signup = await post('/api/auth/signup', { username: 'ordinary', password: 'password123' });
  const user = await signup.json();
  assert.equal((await post('/api/admin/rooms', { id: 'secret' })).status, 401);
  assert.equal((await post('/api/admin/rooms', { id: 'secret' }, user.token)).status, 403);
  assert.equal((await post('/api/admin/moderation', { action: 'ban', accountId: 'made-up', hours: null }, user.token)).status, 403);
  const rejected = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], query: { room: 'lobby1' } });
  sockets.push(rejected);
  const rejection = once(rejected, 'connect_error');
  rejected.connect();
  assert.match((await rejection)[0].message, /sign in/i);
  const created = await post('/api/admin/rooms', { id: 'testroom' }, admin.token);
  assert.equal(created.status, 201);
  const { seed } = await created.json();
  const profile = {
    hotbarItems: [{ type: 'wood', count: 3 }, ...Array(7).fill(null)],
    backpackItems: Array(27).fill(null), selectedHotbarIndex: 0, position: { x: 1, y: 10, z: 2 }
  };
  const saved = await fetch(base + '/api/player-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pixame-Room': 'testroom', 'X-Profile-Revision': '0', Authorization: `Bearer ${user.token}` },
    body: JSON.stringify(profile)
  });
  assert.equal(saved.status, 200);
  async function connect(token, room) {
    const socket = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], query: { room }, auth: { token }, timeout: 3000 });
    sockets.push(socket);
    socket.connect();
    await once(socket, 'connect');
    return socket;
  }
  const first = await connect(user.token, 'testroom');
  const second = await connect(user.token, 'lobby2');
  await connect(admin.token, 'lobby1');
  const status = await (await fetch(base + '/api/admin/status', { headers: { Authorization: `Bearer ${admin.token}` } })).json();
  assert.equal(status.online.length, 3);
  const accountId = status.online.find(player => player.username === 'ordinary').accountId;
  const adminId = status.online.find(player => player.username === 'Google player').accountId;
  assert.equal((await post('/api/admin/moderation', { action: 'ban', accountId: adminId, hours: null }, admin.token)).status, 400);
  const edit = { x: 4, y: 5, z: 6, removed: false, placedType: 'wood' };
  assert.deepEqual(await first.timeout(3000).emitWithAck('blockEdit', edit), { ok: true });
  const furnaceEdit = { x: 5, y: 5, z: 6, removed: false, placedType: 'furnace' };
  assert.deepEqual(await first.timeout(3000).emitWithAck('blockEdit', furnaceEdit), { ok: true });
  const adminProfile = { ...profile, hotbarItems: [{ type: 'iron_ore', count: 1 }, ...Array(7).fill(null)] };
  const adminInsert = await post('/api/furnace', {
    ...furnaceEdit, action: 'insert', slot: 'input', container: 'hotbarItems', index: 0, profile: adminProfile, revision: 0
  }, admin.token, 'testroom');
  assert.equal(adminInsert.status, 200);
  const inserted = await adminInsert.json();
  assert.equal(inserted.furnace.input.count, 1);
  assert.equal(inserted.profile.hotbarItems[0].count, 1);
  assert.equal((await post('/api/admin/rooms/archive', { id: 'testroom' }, admin.token)).status, 409);
  const kicked1 = once(first, 'moderationAction');
  const kicked2 = once(second, 'moderationAction');
  assert.equal((await post('/api/admin/moderation', { action: 'kick', accountId }, admin.token)).status, 200);
  assert.match((await kicked1)[0].message, /removed/i);
  assert.match((await kicked2)[0].message, /removed/i);
  const third = await connect(user.token, 'testroom');
  const fourth = await connect(user.token, 'lobby2');
  const disconnected1 = once(third, 'disconnect');
  const disconnected2 = once(fourth, 'disconnect');
  const bannedMessage = once(third, 'moderationAction');
  assert.equal((await post('/api/admin/moderation', { action: 'ban', accountId, hours: null }, admin.token)).status, 200);
  await Promise.all([disconnected1, disconnected2]);
  assert.match((await bannedMessage)[0].message, /banned/i);
  assert.equal((await post('/api/auth/login', { username: 'ordinary', password: 'password123' })).status, 403);
  assert.equal((await fetch(base + '/api/auth/session', { headers: { Authorization: `Bearer ${user.token}` } })).status, 401);
  assert.equal((await post('/api/admin/rooms/archive', { id: 'testroom' }, admin.token)).status, 200);
  assert.equal((await fetch(base + '/api/rooms').then(response => response.json())).some(room => room.id === 'testroom'), false);
  await stopServer(server);
  server = await startServer(directory, port, { PIXAME_ADMIN_GOOGLE_EMAIL: 'admin@example.test' });
  admin = await googleLogin('admin-token');
  assert.equal((await post('/api/auth/login', { username: 'ordinary', password: 'password123' })).status, 403);
  const restored = await post('/api/admin/rooms', { id: 'testroom' }, admin.token);
  assert.equal((await restored.json()).seed, seed);
  assert.equal((await post('/api/admin/moderation', { action: 'unban', accountId }, admin.token)).status, 200);
  const relogin = await post('/api/auth/login', { username: 'ordinary', password: 'password123' }, null, 'testroom');
  const returned = await relogin.json();
  assert.deepEqual(returned.profile, profile);
  const reconnected = io(base, { autoConnect: false, reconnection: false, transports: ['websocket'], query: { room: 'testroom' }, auth: { token: returned.token } });
  sockets.push(reconnected);
  const edits = once(reconnected, 'worldEdits');
  reconnected.connect();
  assert.deepEqual((await edits)[0], [edit, furnaceEdit]);
  assert.equal((await post('/api/admin/moderation', { action: 'ban', accountId, hours: 0.00001 }, admin.token)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await post('/api/auth/login', { username: 'ordinary', password: 'password123' })).status, 200);
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

test('tree species and cave blocks survive profile and world saves', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixame-species-test-'));
  const port = await unusedPort();
  let server = await startServer(directory, port);
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stopServer(server);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, headers = {}) => fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pixame-Room': 'lobby1', ...headers }, body: JSON.stringify(body)
  });
  let login = await (await post('/api/auth/google', { credential: 'valid-test-token' })).json();
  const treeTypes = ['spruce', 'jungle', 'acacia', 'cherry', 'birch', 'dark_oak']
    .flatMap(species => [`${species}_wood`, `${species}_leaves`]);
  const profile = {
    hotbarItems: [{ type: 'spruce_wood', count: 3 }, { type: 'cherry_leaves', count: 2 },
      { type: 'packed_ice', count: 1 }, ...Array(5).fill(null)],
    backpackItems: [...treeTypes.map(type => ({ type, count: 1 })), ...Array(27 - treeTypes.length).fill(null)],
    selectedHotbarIndex: 0, position: { x: 1, y: 10, z: 2 }
  };
  let auth = { Authorization: `Bearer ${login.token}` };
  assert.equal((await post('/api/player-profile', profile, { ...auth, 'X-Profile-Revision': '0' })).status, 200);
  async function connect(token) {
    const socket = io(base, { autoConnect: false, transports: ['websocket'], query: { room: 'lobby1' }, auth: { token }, timeout: 3000 });
    sockets.push(socket);
    const edits = once(socket, 'worldEdits');
    socket.connect();
    await once(socket, 'connect');
    return { socket, edits: (await edits)[0] };
  }
  const first = await connect(login.token);
  const edits = [...treeTypes, 'packed_ice', 'moss_block', 'glow_mushroom', 'mushroom_stem', 'furnace']
    .map((placedType, x) => ({ x, y: 2, z: 1, removed: false, placedType }));
  for (const edit of edits) assert.deepEqual(await first.socket.timeout(3000).emitWithAck('blockEdit', edit), { ok: true });
  const furnace = edits[edits.length - 1];
  const fuel = await post('/api/furnace', {
    ...furnace, action: 'insert', slot: 'fuel', container: 'hotbarItems', index: 0, profile, revision: 1
  }, auth);
  assert.equal(fuel.status, 200);
  const fueled = await fuel.json();
  assert.equal(fueled.profile.hotbarItems[0].count, 2);
  first.socket.disconnect();
  await stopServer(server);
  server = await startServer(directory, port);
  login = await (await post('/api/auth/google', { credential: 'valid-test-token' })).json();
  assert.equal(login.profile.hotbarItems[0].type, 'spruce_wood');
  assert.equal(login.profile.hotbarItems[1].type, 'cherry_leaves');
  assert.equal(login.profile.hotbarItems[2].type, 'packed_ice');
  assert.deepEqual(login.profile.backpackItems.slice(0, treeTypes.length).map(item => item.type), treeTypes);
  const restored = await connect(login.token);
  assert.deepEqual(restored.edits, edits);
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
  let { token } = await login.json();
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
    const socket = io(base, { autoConnect: false, transports: ['websocket'], query: { room }, auth: { token }, timeout: 3000 });
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
  first.socket.emit('move', { x: 2, y: 3, z: 4, swimming: true });
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
  assert.equal(peerState[first.socket.id].swimming, true);
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
  token = (await relogin.json()).token;
  const newAuth = { Authorization: `Bearer ${token}` };
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
