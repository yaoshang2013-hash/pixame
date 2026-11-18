const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '64kb' }));
app.use('/save-data', (request, response) => response.sendStatus(404));
const sparkBlockDirectory = path.join(__dirname, 'spark', 'block');
const sparkBlockDefinitions = new Map();
const sparkBlockModelDirectory = path.join(__dirname, 'models', 'blocks');
const sparkBlockModelFamilies = new Set(['armchair', 'chair', 'stool', 'table', 'balustrade', 'picket_fence']);
const sparkBlockModels = new Map();
const sparkNamedBlockModels = new Map();
function discoverSparkBlocks(directory = sparkBlockDirectory, relativeDirectory = '') {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      discoverSparkBlocks(path.join(directory, entry.name), relativePath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png') || relativePath.toLowerCase() === 'empty.png') continue;
    const relativeName = relativePath.replace(/\.png$/i, '').split(path.sep).join('/');
    const type = `spark:${relativeName}`;
    const parts = relativeName.split('/');
    const category = parts[0];
    const label = parts.slice(1).join(' / ').replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) || category;
    sparkBlockDefinitions.set(type, {
      type,
      category,
      label,
      textureUrl: `/spark/block/${relativeName.split('/').map(encodeURIComponent).join('/')}.png`
    });
  }
}
discoverSparkBlocks();
function discoverSparkBlockModels(directory = sparkBlockModelDirectory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      discoverSparkBlockModels(filePath);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    let modelFile;
    try {
      modelFile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.error(`Failed to load Spark block model ${filePath}:`, error);
      continue;
    }
    for (const geometry of modelFile['minecraft:geometry'] || []) {
      const identifier = geometry.description?.identifier;
      const family = identifier?.match(/^geometry\.spark\.(armchair|chair|stool|table|balustrade|picket_fence)$/)?.[1];
      if (family && sparkBlockModelFamilies.has(family)) sparkBlockModels.set(family, geometry);
      if (typeof identifier !== 'string') continue;
      if (sparkNamedBlockModels.has(identifier)) sparkNamedBlockModels.set(identifier, null);
      else sparkNamedBlockModels.set(identifier, geometry);
    }
  }
}
discoverSparkBlockModels();
function discoverNamedSparkModels() {
  const matched = [];
  for (const definition of sparkBlockDefinitions.values()) {
    const parts = definition.type.slice('spark:'.length).split('/');
    if (parts.length !== 2) continue;
    const names = [`geometry.spark.realism.${parts[1]}`, `geometry.spark.${parts[1]}`];
    const candidates = names.filter(name => sparkNamedBlockModels.has(name));
    if (candidates.length !== 1) continue;
    const geometry = sparkNamedBlockModels.get(candidates[0]);
    if (!geometry || !Array.isArray(geometry.bones)) continue;
    const cubes = geometry.bones.flatMap(bone => bone.cubes || []);
    if (cubes.length === 0 || cubes.some(cube => cube.uv && !Array.isArray(cube.uv) &&
      Object.values(cube.uv).some(face => face.material_instance && face.material_instance !== 'default'))) continue;
    const file = path.join(sparkBlockDirectory, parts[0], `${parts[1]}.png`);
    const header = Buffer.alloc(24);
    const fd = fs.openSync(file, 'r');
    let bytesRead;
    try {
      bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (bytesRead !== 24 || header.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      header.readUInt32BE(16) !== geometry.description.texture_width ||
      header.readUInt32BE(20) !== geometry.description.texture_height) continue;
    matched.push({ type: definition.type, geometry });
  }
  return matched;
}
const namedSparkModels = discoverNamedSparkModels();
app.use(express.static(__dirname));

const blockTypes = new Set(['grass', 'dirt', 'sand', 'snow', 'stone', 'iron_ore', 'wood', 'leaves', 'planks', 'crafting_table', 'furnace', ...sparkBlockDefinitions.keys()]);
const itemTypes = new Set([...blockTypes, 'iron_ingot', 'sticks', 'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe', 'wooden_sword', 'stone_sword', 'torch']);
const saveDirectory = process.env.PIXAME_SAVE_DIRECTORY || path.join(__dirname, 'save-data');
const accountSavePath = path.join(saveDirectory, 'accounts.json');
const playerSavePath = path.join(saveDirectory, 'players.json');
const furnaceSavePath = path.join(saveDirectory, 'furnace-state.json');
const roomRegistryPath = path.join(saveDirectory, 'rooms.json');
const bansPath = path.join(saveDirectory, 'bans.json');
const sessions = new Map();
const adminGoogleEmail = (process.env.PIXAME_ADMIN_GOOGLE_EMAIL || '').trim().toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID || '751302852382-vn0e9d0qb6sp8v5h52i9cr37ctt20197.apps.googleusercontent.com';
const googleClient = new OAuth2Client(googleClientId);

app.get('/api/auth/google-config', (request, response) => {
  response.json({ clientId: googleClientId });
});

app.get('/api/spark-blocks', (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(Array.from(sparkBlockDefinitions.values()));
});
app.get('/api/spark-block-models', (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json([...Array.from(sparkBlockModels, ([family, geometry]) => ({ family, geometry })), ...namedSparkModels]);
});
app.get('/api/legacy-block-textures', (request, response) => {
  response.json({ available: fs.existsSync(path.join(__dirname, 'block', 'stone.png')) });
});

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error);
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

const accounts = loadJson(accountSavePath, {});
const bans = fs.existsSync(bansPath) ? JSON.parse(fs.readFileSync(bansPath, 'utf8')) : {};
if (!bans || typeof bans !== 'object' || Array.isArray(bans) ||
    !Object.values(bans).every(ban => ban && (ban.until === null || Number.isFinite(ban.until) && ban.until > 0))) {
  throw new Error('Invalid ban state; refusing to ignore bans.');
}
let savedFurnaceState = null;
if (fs.existsSync(furnaceSavePath)) {
  savedFurnaceState = JSON.parse(fs.readFileSync(furnaceSavePath, 'utf8'));
  if (!savedFurnaceState || !savedFurnaceState.profiles || !savedFurnaceState.furnaces) {
    throw new Error('Invalid furnace state save; refusing to overwrite player data.');
  }
}
app.use('/api', (request, response, next) => {
  const roomId = request.get('x-pixame-room') || 'legacy';
  const room = rooms.get(roomId);
  if (!room) return response.status(400).json({ error: 'Invalid room.' });
  request.room = room;
  next();
});

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, accountId);
  return token;
}

function getAccountFromRequest(request) {
  const header = request.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const accountId = sessions.get(token);
  if (!accountId) return null;
  const account = Object.values(accounts).find(entry => entry.id === accountId);
  return account && !isBanned(account.id) ? account : null;
}

function isBanned(accountId) {
  const ban = bans[accountId];
  return !!ban && (ban.until === null || ban.until > Date.now());
}

function isAdmin(account) {
  return !!(adminGoogleEmail && account?.googleSub && account.verifiedEmail === adminGoogleEmail);
}

function validSlots(slots, expectedLength) {
  return Array.isArray(slots) && slots.length === expectedLength && slots.every(slot => slot === null ||
    slot && itemTypes.has(slot.type) && Number.isInteger(slot.count) && slot.count >= 1 && slot.count <= 99);
}

function validPlayerProfile(profile) {
  return profile && validSlots(profile.hotbarItems, 8) && validSlots(profile.backpackItems, 27) &&
    Number.isInteger(profile.selectedHotbarIndex) && profile.selectedHotbarIndex >= 0 && profile.selectedHotbarIndex < 8 &&
    profile.position && ['x', 'y', 'z'].every(axis => Number.isFinite(profile.position[axis]) && Math.abs(profile.position[axis]) < 100000);
}

app.post('/api/auth/signup', (request, response) => {
  const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const accountKey = username.toLowerCase();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return response.status(400).json({ error: 'Username must be 3-24 letters, numbers, or underscores.' });
  if (password.length < 8 || password.length > 128) return response.status(400).json({ error: 'Password must be 8-128 characters.' });
  if (accounts[accountKey]) return response.status(409).json({ error: 'That username is already in use.' });

  const salt = crypto.randomBytes(16).toString('hex');
  const account = { id: crypto.randomUUID(), username, salt, passwordHash: hashPassword(password, salt) };
  accounts[accountKey] = account;
  try {
    saveJson(accountSavePath, accounts);
  } catch (error) {
    console.error('Failed to save account:', error);
    return response.status(500).json({ error: 'Could not create the account.' });
  }
  return response.status(201).json({ token: createSession(account.id), username: account.username, isAdmin: false, profile: null, revision: 0 });
});

app.post('/api/auth/login', (request, response) => {
  const { playerProfiles, profileRevisions } = request.room;
  const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const account = accounts[username.toLowerCase()];
  if (!account) return response.status(401).json({ error: 'Invalid username or password.' });
  if (isBanned(account.id)) return response.status(403).json({ error: 'This account is banned.' });
  const submittedHash = hashPassword(password, account.salt);
  if (!crypto.timingSafeEqual(Buffer.from(submittedHash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) {
    return response.status(401).json({ error: 'Invalid username or password.' });
  }
  return response.json({ token: createSession(account.id), username: account.username, isAdmin: false, profile: playerProfiles[account.id] || null, revision: profileRevisions[account.id] || 0 });
});

app.post('/api/auth/google', async (request, response) => {
  const { playerProfiles, profileRevisions } = request.room;
  const credential = request.body && request.body.credential;
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > 16384) {
    return response.status(400).json({ error: 'Invalid Google credential.' });
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
    payload = ticket.getPayload();
    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
      return response.status(401).json({ error: 'Invalid Google identity.' });
    }
  } catch (error) {
    console.error('Google sign-in verification failed.');
    return response.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
  const accountKey = `google:${payload.sub}`;
  let account = accounts[accountKey];
  if (account && isBanned(account.id)) return response.status(403).json({ error: 'This account is banned.' });
  const verifiedEmail = adminGoogleEmail && payload.email_verified === true && typeof payload.email === 'string' &&
    payload.email.trim().toLowerCase() === adminGoogleEmail ? adminGoogleEmail : null;
  if (!account || account.verifiedEmail !== verifiedEmail) {
    account = account
      ? { ...account, verifiedEmail }
      : { id: crypto.randomUUID(), username: 'Google player', googleSub: payload.sub, verifiedEmail };
    try {
      saveJson(accountSavePath, { ...accounts, [accountKey]: account });
    } catch (error) {
      console.error('Failed to save Google account:', error);
      return response.status(500).json({ error: 'Could not create the Google account.' });
    }
    accounts[accountKey] = account;
  }
  return response.json({ token: createSession(account.id), username: account.username, isAdmin: isAdmin(account), profile: playerProfiles[account.id] || null, revision: profileRevisions[account.id] || 0 });
});

app.get('/api/auth/session', (request, response) => {
  const { playerProfiles, profileRevisions } = request.room;
  const account = getAccountFromRequest(request);
  if (!account) return response.status(401).json({ error: 'Sign in is required.' });
  return response.json({ username: account.username, provider: account.googleSub ? 'google' : 'password', isAdmin: isAdmin(account), profile: playerProfiles[account.id] || null, revision: profileRevisions[account.id] || 0 });
});

app.post('/api/player-profile', (request, response) => {
  const { playerProfiles, profileRevisions, furnaces, furnaceSavePath } = request.room;
  const account = getAccountFromRequest(request);
  if (!account) return response.status(401).json({ error: 'Sign in is required.' });
  if (!validPlayerProfile(request.body)) return response.status(400).json({ error: 'Invalid player profile.' });
  const revision = profileRevisions[account.id] || 0;
  if (request.get('x-profile-revision') !== String(revision)) return response.status(409).json({ error: 'Player data changed in another session. Sign in again.' });
  const nextRevisions = { ...profileRevisions, [account.id]: revision + 1 };
  try {
    saveJson(furnaceSavePath, { profiles: { ...playerProfiles, [account.id]: request.body }, furnaces, revisions: nextRevisions });
  } catch (error) {
    console.error('Failed to save player profile:', error);
    return response.status(500).json({ error: 'Could not save the player profile.' });
  }
  playerProfiles[account.id] = request.body;
  profileRevisions[account.id] = revision + 1;
  return response.json({ revision: revision + 1 });
});

function isValidWorldEdit(edit) {
  return edit && Number.isInteger(edit.x) && Number.isInteger(edit.y) && Number.isInteger(edit.z)
    && typeof edit.removed === 'boolean'
    && (edit.placedType === null || blockTypes.has(edit.placedType));
}

function loadWorldEdits(worldSavePath, strict = false) {
  if (!fs.existsSync(worldSavePath)) return new Map();
  try {
    const savedEdits = JSON.parse(fs.readFileSync(worldSavePath, 'utf8'));
    if (!Array.isArray(savedEdits)) throw new Error('World save must contain an array of edits.');
    const edits = new Map();
    for (const edit of savedEdits) {
      if (!isValidWorldEdit(edit)) throw new Error('World save contains an invalid edit.');
      edits.set(`${edit.x},${edit.y},${edit.z}`, edit);
    }
    console.log(`Loaded ${edits.size} world edits from ${worldSavePath}`);
    return edits;
  } catch (error) {
    console.error(`Failed to load world save at ${worldSavePath}:`, error);
    if (strict) throw error;
    return new Map();
  }
}

function createRoom(id) {
  const legacy = id === 'legacy';
  const directory = legacy ? saveDirectory : path.join(saveDirectory, 'rooms', id);
  const worldPath = path.join(directory, 'world.json');
  const furnacePath = path.join(directory, 'furnace-state.json');
  let state = legacy ? savedFurnaceState : null;
  if (!legacy && fs.existsSync(furnacePath)) {
    state = JSON.parse(fs.readFileSync(furnacePath, 'utf8'));
    if (!state || !state.profiles || !state.furnaces || !state.revisions) {
      throw new Error(`Invalid room state for ${id}; refusing to overwrite player data.`);
    }
  }
  return {
    id,
    worldSavePath: worldPath,
    furnaceSavePath: furnacePath,
    worldEdits: loadWorldEdits(worldPath, !legacy),
    playerProfiles: state ? state.profiles : legacy ? loadJson(playerSavePath, {}) : {},
    furnaces: state ? state.furnaces : {},
    profileRevisions: state?.revisions || {},
    players: {}
  };
}
const initialRoomRegistry = {
  lobby1: { seed: 1, active: true },
  lobby2: { seed: 2, active: true },
  lobby3: { seed: 3, active: true }
};
let roomRegistry = fs.existsSync(roomRegistryPath) ? JSON.parse(fs.readFileSync(roomRegistryPath, 'utf8')) : initialRoomRegistry;
if (!roomRegistry || typeof roomRegistry !== 'object' || Array.isArray(roomRegistry) ||
    !Object.entries(roomRegistry).every(([id, room]) => /^[a-z0-9_-]{1,24}$/.test(id) && id !== 'legacy' &&
      room && Number.isInteger(room.seed) && room.seed >= 1 && room.seed <= 2147483647 && typeof room.active === 'boolean') ||
    !Object.values(roomRegistry).some(room => room.active)) {
  throw new Error('Invalid room registry; refusing to overwrite room data.');
}
const rooms = new Map([['legacy', createRoom('legacy')]]);
for (const [id, entry] of Object.entries(roomRegistry)) if (entry.active) rooms.set(id, createRoom(id));

app.get('/api/rooms', (request, response) => {
  response.json(Object.entries(roomRegistry).filter(([, room]) => room.active).map(([id, room]) => ({ id, seed: room.seed })));
});

function requireAdmin(request, response, next) {
  const account = getAccountFromRequest(request);
  if (!account) return response.status(401).json({ error: 'Sign in is required.' });
  if (!isAdmin(account)) return response.status(403).json({ error: 'Administrator access is required.' });
  request.admin = account;
  next();
}

app.get('/api/admin/status', requireAdmin, (request, response) => {
  const online = Array.from(io.sockets.sockets.values()).map(socket => ({
    accountId: socket.data.account.id, username: socket.data.account.username, room: socket.data.room.id
  }));
  const activeBans = Object.entries(bans).filter(([id]) => isBanned(id)).map(([accountId, ban]) => ({ accountId, until: ban.until }));
  response.json({ online, bans: activeBans, rooms: roomRegistry });
});

app.post('/api/admin/rooms', requireAdmin, (request, response) => {
  const id = typeof request.body.id === 'string' ? request.body.id.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{1,24}$/.test(id) || id === 'legacy') return response.status(400).json({ error: 'Invalid room name.' });
  const existing = Object.hasOwn(roomRegistry, id) ? roomRegistry[id] : null;
  if (existing?.active) return response.status(409).json({ error: 'Room already exists.' });
  const entry = existing || { seed: crypto.randomInt(1, 2147483647), active: false };
  const next = { ...roomRegistry, [id]: { ...entry, active: true } };
  try {
    const room = createRoom(id);
    saveJson(roomRegistryPath, next);
    roomRegistry = next;
    rooms.set(id, room);
  } catch (error) {
    console.error('Failed to create room:', error);
    return response.status(500).json({ error: 'Could not create or restore the room.' });
  }
  return response.status(201).json({ id, seed: entry.seed });
});

app.post('/api/admin/rooms/archive', requireAdmin, (request, response) => {
  const id = request.body.id;
  if (typeof id !== 'string' || !Object.hasOwn(roomRegistry, id) || !roomRegistry[id].active) return response.status(404).json({ error: 'Room not found.' });
  if (Object.values(roomRegistry).filter(room => room.active).length <= 1) return response.status(400).json({ error: 'At least one room must remain.' });
  if (Array.from(io.sockets.sockets.values()).some(socket => socket.data.room.id === id)) {
    return response.status(409).json({ error: 'Room must be empty before archiving.' });
  }
  const next = { ...roomRegistry, [id]: { ...roomRegistry[id], active: false } };
  try {
    saveJson(roomRegistryPath, next);
  } catch (error) {
    console.error('Failed to archive room:', error);
    return response.status(500).json({ error: 'Could not archive the room.' });
  }
  roomRegistry = next;
  rooms.delete(id);
  response.json({ ok: true });
});

app.post('/api/admin/moderation', requireAdmin, (request, response) => {
  const { action, accountId, hours } = request.body;
  const target = Object.values(accounts).find(account => account.id === accountId);
  if (!target || target.id === request.admin.id || isAdmin(target)) return response.status(400).json({ error: 'Invalid target account.' });
  if (!['kick', 'ban', 'unban'].includes(action)) return response.status(400).json({ error: 'Invalid moderation action.' });
  if (action === 'ban' && !(hours === null || Number.isFinite(hours) && hours > 0 && hours <= 87600)) {
    return response.status(400).json({ error: 'Ban duration must be positive hours or permanent.' });
  }
  if (action !== 'kick') {
    const next = { ...bans };
    if (action === 'ban') next[accountId] = { until: hours === null ? null : Date.now() + hours * 3600000 };
    else delete next[accountId];
    try {
      saveJson(bansPath, next);
    } catch (error) {
      console.error('Failed to save moderation state:', error);
      return response.status(500).json({ error: 'Could not save moderation state.' });
    }
    if (action === 'ban') bans[accountId] = next[accountId];
    else delete bans[accountId];
  }
  if (action !== 'unban') {
    if (action === 'ban') for (const [token, id] of sessions) if (id === accountId) sessions.delete(token);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.account.id !== accountId) continue;
      socket.emit('moderationAction', { message: action === 'ban' ? 'Your account has been banned.' : 'You were removed by an administrator.' });
      socket.disconnect(true);
    }
  }
  response.json({ ok: true });
});

const smeltDuration = 10000;

function advanceFurnace(furnace, now) {
  let time = furnace.endAt || now;
  while (true) {
    const canSmelt = furnace.input && furnace.input.type === 'iron_ore' &&
      (!furnace.output || furnace.output.count < 99);
    if (!canSmelt) {
      furnace.endAt = null;
      return;
    }
    if (!furnace.endAt) {
      if (!furnace.fuel) return;
      if (--furnace.fuel.count === 0) furnace.fuel = null;
      furnace.endAt = time + smeltDuration;
    }
    if (furnace.endAt > now) return;
    time = furnace.endAt;
    if (--furnace.input.count === 0) furnace.input = null;
    if (furnace.output) furnace.output.count++;
    else furnace.output = { type: 'iron_ingot', count: 1 };
    furnace.endAt = null;
  }
}

function getFurnaceKey(body) {
  if (!body || !['x', 'y', 'z'].every(axis => Number.isInteger(body[axis]) && Math.abs(body[axis]) < 100000)) return null;
  return `${body.x},${body.y},${body.z}`;
}

function emptyFurnace() {
  return { input: null, fuel: null, output: null, endAt: null };
}

app.post('/api/furnace', (request, response) => {
  const { worldEdits, furnaces, playerProfiles, profileRevisions, furnaceSavePath } = request.room;
  const account = getAccountFromRequest(request);
  if (!account) return response.status(401).json({ error: 'Sign in is required.' });
  const key = getFurnaceKey(request.body);
  if (!key || worldEdits.get(key)?.placedType !== 'furnace') return response.status(404).json({ error: 'Furnace no longer exists.' });
  const furnace = structuredClone(furnaces[key] || emptyFurnace());
  advanceFurnace(furnace, Date.now());
  let profile = null;
  const action = request.body.action;
  if (action !== 'view') {
    if (!validPlayerProfile(request.body.profile)) return response.status(400).json({ error: 'Invalid player profile.' });
    if (request.body.revision !== (profileRevisions[account.id] || 0)) return response.status(409).json({ error: 'Player data changed in another session. Sign in again.' });
    profile = structuredClone(request.body.profile);
    const slot = request.body.slot;
    if (!['input', 'fuel', 'output'].includes(slot)) return response.status(400).json({ error: 'Invalid furnace slot.' });
    if (action === 'insert') {
      if (!['hotbarItems', 'backpackItems'].includes(request.body.container) ||
          !Number.isInteger(request.body.index) || request.body.index < 0 ||
          request.body.index >= profile[request.body.container].length || slot === 'output') {
        return response.status(400).json({ error: 'Invalid inventory selection.' });
      }
      const source = profile[request.body.container][request.body.index];
      const allowed = source && (slot === 'input' ? source.type === 'iron_ore' : ['wood', 'planks'].includes(source.type));
      if (!allowed || furnace[slot] && (furnace[slot].type !== source.type || furnace[slot].count >= 99)) {
        return response.status(400).json({ error: 'Select a compatible item and an available slot.' });
      }
      if (furnace[slot]) furnace[slot].count++;
      else furnace[slot] = { type: source.type, count: 1 };
      if (!isAdmin(account) && --source.count === 0) profile[request.body.container][request.body.index] = null;
    } else if (action === 'take') {
      const source = furnace[slot];
      if (!source) return response.status(400).json({ error: 'The furnace slot is empty.' });
      const all = [...profile.hotbarItems, ...profile.backpackItems];
      let destination = all.find(item => item && item.type === source.type && item.count < 99);
      if (destination) destination.count++;
      else {
        const container = [profile.hotbarItems, profile.backpackItems].find(items => items.includes(null));
        if (!container) return response.status(400).json({ error: 'Inventory is full.' });
        container[container.indexOf(null)] = { type: source.type, count: 1 };
      }
      if (--source.count === 0) furnace[slot] = null;
    } else {
      return response.status(400).json({ error: 'Invalid furnace action.' });
    }
    advanceFurnace(furnace, Date.now());
  }
  const nextProfiles = profile ? { ...playerProfiles, [account.id]: profile } : playerProfiles;
  const nextFurnaces = { ...furnaces, [key]: furnace };
  const nextRevision = (profileRevisions[account.id] || 0) + (profile ? 1 : 0);
  const nextRevisions = profile ? { ...profileRevisions, [account.id]: nextRevision } : profileRevisions;
  if (profile || JSON.stringify(furnace) !== JSON.stringify(furnaces[key] || emptyFurnace())) {
    try {
      saveJson(furnaceSavePath, { profiles: nextProfiles, furnaces: nextFurnaces, revisions: nextRevisions });
    } catch (error) {
      console.error('Failed to save furnace:', error);
      return response.status(500).json({ error: 'Could not save furnace state.' });
    }
  }
  if (profile) playerProfiles[account.id] = profile;
  if (profile) profileRevisions[account.id] = nextRevision;
  furnaces[key] = furnace;
  return response.json({ furnace, profile, revision: nextRevision, serverTime: Date.now() });
});

function saveWorldEdits(room) {
  const { worldSavePath, worldEdits } = room;
  fs.mkdirSync(path.dirname(worldSavePath), { recursive: true });
  const temporaryPath = `${worldSavePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(Array.from(worldEdits.values()), null, 2));
  fs.renameSync(temporaryPath, worldSavePath);
}

io.use((socket, next) => {
  const roomId = socket.handshake.query.room || 'legacy';
  const room = rooms.get(roomId);
  if (!room) return next(new Error('Invalid room.'));
  const accountId = sessions.get(socket.handshake.auth?.token);
  const account = Object.values(accounts).find(entry => entry.id === accountId);
  if (!account || isBanned(account.id)) return next(new Error('Sign in is required or your account is banned.'));
  socket.data.room = room;
  socket.data.account = account;
  next();
});

io.on('connection', socket => {
  const room = socket.data.room;
  const { players, worldEdits, furnaces, worldSavePath } = room;
  socket.join(room.id);
  console.log('player connected', socket.id);

  // send current players to the new client
  socket.emit('state', players);
  socket.emit('worldEdits', Array.from(worldEdits.values()));

  socket.on('move', pos => {
    players[socket.id] = pos;
  });

  socket.on('blockEdit', (edit, acknowledge) => {
    if (!edit || !Number.isInteger(edit.x) || !Number.isInteger(edit.y) || !Number.isInteger(edit.z)) return;
    if (edit.y === -32) return;
    if (typeof edit.removed !== 'boolean') return;
    if (edit.placedType !== null && !blockTypes.has(edit.placedType)) return;
    const key = `${edit.x},${edit.y},${edit.z}`;
    if (worldEdits.get(key)?.placedType === 'furnace' && edit.placedType !== 'furnace') {
      const furnace = furnaces[key];
      if (furnace && (furnace.input || furnace.fuel || furnace.output || furnace.endAt)) {
        if (typeof acknowledge === 'function') acknowledge({ error: 'Empty the furnace before breaking it.' });
        return;
      }
    }

    const worldEdit = {
      x: edit.x,
      y: edit.y,
      z: edit.z,
      removed: edit.removed,
      placedType: edit.placedType
    };
    const previousEdit = worldEdits.get(key);
    worldEdits.set(key, worldEdit);
    try {
      saveWorldEdits(room);
    } catch (error) {
      if (previousEdit) worldEdits.set(key, previousEdit);
      else worldEdits.delete(key);
      socket.data.worldEditError = 'A world change could not be saved. Reload before switching rooms.';
      console.error(`Failed to save world edits to ${worldSavePath}:`, error);
      if (typeof acknowledge === 'function') acknowledge({ error: 'Could not save the world edit.' });
      return;
    }
    if (previousEdit?.placedType === 'furnace' && edit.placedType !== 'furnace') delete furnaces[key];
    socket.broadcast.to(room.id).emit('blockEdit', worldEdit);
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('player disconnected', socket.id);
    delete players[socket.id];
    socket.broadcast.to(room.id).emit('playerDisconnected', socket.id);
  });

  socket.on('roomSwitchBarrier', acknowledge => {
    if (typeof acknowledge === 'function') {
      acknowledge(socket.data.worldEditError ? { error: socket.data.worldEditError } : { ok: true });
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) io.to(room.id).emit('state', room.players);
}, 100);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server listening on http://127.0.0.1:${port}`));
