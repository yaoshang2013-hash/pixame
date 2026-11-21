const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('three');
const biomes = require('../biomes.js');
const caves = require('../caves.js');

test('biome regions span multiple 32-block chunks, including negative coordinates', () => {
  assert.equal(biomes.chunkSize, 32);
  assert.equal(biomes.regionSize, 128);
  const counts = new Map();
  for (let x = -384; x <= 384; x += 32) for (let z = -384; z <= 384; z += 32) {
    const region = biomes.sampleRegion(x + 16, z + 16, 1);
    counts.set(region.name, (counts.get(region.name) || 0) + 1);
  }
  for (const count of counts.values()) assert.ok(count >= 4);
});

test('terrain LOD covers 10 high, 25 medium and 256 far chunk radii', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        const fullDetailRadius = 80;');
  const end = source.indexOf('        function removeTerrainChunk(', start);
  assert.ok(start !== -1 && end !== -1);
  const projection = { updateProjectionMatrix() {} };
  const context = vm.createContext({chunkSize: 32, camera: {...projection}, viewCamera: {...projection}});
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.lodApi = {terrainLodAtDistance, selectTerrainChunkLods};`, context);
  const distances = [0, 80, 80.1, 320, 320.1, 800, 800.1, 8192, 8192.1];
  const candidates = distances.map((distance, index) => ({key: String(index), chunkX: index, chunkZ: 0, distance}));
  const selected = context.lodApi.selectTerrainChunkLods(candidates);
  assert.deepEqual(Array.from(selected, chunk => chunk.lod),
    ['high', 'high', 'surface', 'surface', 'medium', 'medium']);
  assert.equal(context.lodApi.terrainLodAtDistance(800.1), 'far');
  assert.equal(context.lodApi.terrainLodAtDistance(8192), 'far');
  assert.equal(context.lodApi.terrainLodAtDistance(8192.1), null);
});

test('medium terrain atlas downsamples every texture tile to 4 by 4', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        const mediumTile = 4;');
  const end = source.indexOf('        updateMediumAtlas();', start);
  assert.ok(start !== -1 && end !== -1);
  const draws = [];
  const canvas = {
    getContext: () => ({clearRect() {}, drawImage: (...args) => draws.push(args)})
  };
  class CanvasTexture { constructor(image) { this.image = image; } }
  const original = {};
  const context = vm.createContext({
    document: {createElement: () => canvas}, THREE: {CanvasTexture, NearestFilter: 1},
    atlasTileCount: 3, tile: 16, blockTexture: {image: original}
  });
  vm.runInContext(`${source.slice(start, end)}\nupdateMediumAtlas();`, context);
  assert.equal(canvas.width, 12);
  assert.equal(canvas.height, 4);
  assert.deepEqual(draws, [
    [original, 0, 0, 16, 16, 0, 0, 4, 4],
    [original, 16, 0, 16, 16, 4, 0, 4, 4],
    [original, 32, 0, 16, 16, 8, 0, 4, 4]
  ]);
});

test('terrain builds are batched and discard superseded pending chunks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function removeTerrainChunk(');
  const end = source.indexOf('        function updateTerrainChunks()', start);
  assert.ok(start !== -1 && end !== -1);
  const scheduled = [];
  const built = [];
  let time = 0;
  const context = vm.createContext({
    pendingTerrainChunks: [], terrainBuildScheduled: false, terrainChunks: new Map(),
    activeWaterCells: new Set(), activeTreeBlocks: new Set(),
    floorGroup: {add() {}, remove() {}},
    disposeSparkModelGeometries() {}, updateBlockShadowCasting() {},
    performance: {now: () => (time += 10)},
    requestAnimationFrame: callback => scheduled.push(callback),
    buildTerrainChunk: (x, z, lod, caveDetail) => {
      built.push(x);
      return {group: {traverse() {}}, waterKeys: [], treeKeys: [], lod, caveDetail};
    }
  });
  vm.runInContext(source.slice(start, end), context);
  const candidate = x => ({key: `${x},0`, chunkX: x, chunkZ: 0, lod: 'medium', caveDetail: false});
  context.pendingTerrainChunks = [candidate(1), candidate(2)];
  context.buildPendingTerrainChunks();
  assert.deepEqual(built, [1]);
  assert.equal(scheduled.length, 1);
  context.pendingTerrainChunks = [candidate(3)];
  scheduled.shift()();
  assert.deepEqual(built, [1, 3]);
  assert.equal(scheduled.length, 0);
});

test('terrain visibility retains nearby shadow casters and culls off-screen chunks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        const terrainFrustum =');
  const end = source.indexOf('        function updateBlockShadowCasting(', start);
  assert.ok(start !== -1 && end !== -1);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 2, 0);
  const chunk = (x, z, lod, min, max) => ({
    chunkX: x, chunkZ: z, lod, group: {}, bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))
  });
  const front = chunk(0, -2, 'medium', [-1, 0, -64], [1, 5, -63]);
  const behind = chunk(0, 2, 'medium', [-1, 0, 63], [1, 5, 64]);
  const nearbyShadow = chunk(0, 0, 'high', [-1, 0, 1], [1, 5, 2]);
  const context = vm.createContext({
    THREE, camera, chunkSize: 32, blockShadowRadius: 24,
    terrainChunks: new Map([['front', front], ['behind', behind], ['nearby', nearbyShadow]])
  });
  vm.runInContext(source.slice(start, end), context);
  context.updateTerrainVisibility(camera);
  assert.equal(front.group.visible, true);
  assert.equal(behind.group.visible, false);
  assert.equal(nearbyShadow.group.visible, true);
});

test('all requested biomes appear with distinct temperatures and appropriate tree species', () => {
  const found = new Map();
  for (let x = -20; x <= 20; x++) {
    for (let z = -20; z <= 20; z++) {
      const region = biomes.sampleRegion(x * 128, z * 128, 1);
      found.set(region.name, region);
      assert.equal(biomes.sampleRegion(x * 128, z * 128, 1), region);
    }
  }
  for (const name of ['snow', 'tundra', 'taiga', 'cherry_grove', 'forest', 'meadow', 'plains', 'savanna', 'rainforest', 'desert',
    'birch_forest', 'dark_forest', 'mixed_forest', 'cold_taiga', 'alpine_meadow', 'dry_scrub', 'frozen_forest']) {
    assert.ok(found.has(name), `Missing ${name}`);
  }
  assert.equal(new Set([...found.values()].map(region => region.temperature)).size, found.size);
  assert.equal(found.get('taiga').tree, 'spruce');
  assert.equal(found.get('rainforest').tree, 'jungle');
  assert.equal(found.get('savanna').tree, 'acacia');
  assert.equal(found.get('cherry_grove').tree, 'cherry');
  assert.equal(found.get('tundra').tree, null);
  assert.ok([...found.values()].some(region => region.secondTree));
});

test('climate transitions smoothly across region edges and preserves region centers', () => {
  for (const [x, z] of [[128, 64], [0, -64], [-128, -128]]) {
    const before = biomes.sampleClimate(x - 0.001, z, 1);
    const after = biomes.sampleClimate(x + 0.001, z, 1);
    assert.ok(Math.abs(before.temperature - after.temperature) < 0.001);
    assert.ok(Math.abs(before.moisture - after.moisture) < 0.001);
  }
  const center = biomes.sampleClimate(64, 64, 1);
  assert.equal(center.temperature, center.region.temperature);
  assert.equal(center.moisture, center.region.moisture);
  const edges = new Set();
  let transitions = 0;
  for (let z = -128; z <= 128; z += 8) {
    for (let x = -128; x <= 128; x++) {
      const climate = biomes.sampleClimate(x, z, 1);
      if (climate.transitions.length) transitions++;
      if (climate.region !== biomes.sampleRegion(x + 1, z, 1)) edges.add(x);
    }
  }
  assert.ok(transitions > 0);
  assert.ok(edges.size > 10, 'biome boundaries should curve instead of following straight grid lines');
});

test('natural caves include frozen, moss and fungal biomes with occasional water', () => {
  for (const seed of [1, 2, 3]) {
    const counts = { ice: 0, moss: 0, fungal: 0, water: 0 };
    for (let x = -384; x <= 384; x += 8) for (let z = -384; z <= 384; z += 8) {
      const climate = biomes.sampleClimate(x, z, seed);
      const cave = caves.sample(x, z, seed, climate);
      if (!cave) continue;
      assert.deepEqual(cave, caves.sample(x, z, seed, climate));
      assert.ok(cave.floor > -32 && cave.ceiling < -4);
      assert.equal(caves.contains(cave, cave.floor), true);
      assert.equal(caves.contains(cave, cave.floor - 1), false);
      if (climate.region.temperature <= 0.25) assert.equal(cave.biome, 'ice');
      counts[cave.biome]++;
      if (cave.water) {
        counts.water++;
        assert.ok(caves.contains(cave, cave.floor));
      }
    }
    assert.ok(counts.ice > 20 && counts.moss > 20 && counts.fungal > 20);
    assert.ok(counts.water < (counts.ice + counts.moss + counts.fungal) / 3);
  }
  const water = new Set();
  for (let x = -192; x < 192; x++) {
    for (let z = -192; z < 192; z++) {
      const climate = biomes.sampleClimate(x, z, 1);
      const cave = caves.sample(x, z, 1, climate);
      if (cave?.water) water.add(`${x},${z}`);
    }
  }
  let pools = 0;
  while (water.size) {
    const queue = [water.values().next().value];
    water.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i].split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${z + dz}`;
        if (water.delete(key)) queue.push(key);
      }
    }
    assert.ok(queue.length === 3 || queue.length === 4, `pool has ${queue.length} blocks`);
    pools++;
  }
  assert.ok(pools > 5);
});

test('water immersion follows the water blocks and ignores placed blocks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function waterSurfaceAt(');
  const end = source.indexOf('        function undergroundBlockType(', start);
  assert.ok(start !== -1 && end !== -1);
  const placedBlocks = new Map();
  const context = vm.createContext({
    waterLevel: 1, worldBottomY: -32, placedBlocks,
    blockKey: (x, y, z) => `${x},${y},${z}`,
    isWaterAt: x => x >= 0,
    caveProfileAt: () => ({ floor: -21, ceiling: -15, water: true })
  });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.waterSurfaceAt(1.5, 0.3, 0.5), 1);
  assert.equal(context.waterSurfaceAt(-1.5, -20.5, 0.5), -20);
  assert.equal(context.waterSurfaceAt(-1.5, -19.9, 0.5), null);
  placedBlocks.set('-2,-21,0', 'stone');
  assert.equal(context.waterSurfaceAt(-1.5, -20.5, 0.5), null);
  placedBlocks.set('1,0,0', 'stone');
  assert.equal(context.waterSurfaceAt(1.5, 0.3, 0.5), null);
});

test('placed short grass does not create solid terrain or raise its height', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const solidStart = source.indexOf('        function isSolidBlockAt(');
  const solidEnd = source.indexOf('        function disposeSparkModelGeometries(', solidStart);
  const heightStart = source.indexOf('        function sampleTerrainHeight(');
  const heightEnd = source.indexOf('        function isWaterAt(', heightStart);
  assert.ok(solidStart !== -1 && solidEnd !== -1 && heightStart !== -1 && heightEnd !== -1);
  const placedBlocks = new Map([['1,4,2', 'short_grass']]);
  const context = vm.createContext({
    blockKey: (x, y, z) => `${x},${y},${z}`, terrainColumnKey: (x, z) => `${x},${z}`,
    placedBlocks, placedColumns: new Map([['1,2', new Map([[4, 'short_grass']])]]),
    removedBlocks: new Set(['1,4,2']), activeWaterCells: new Set(), activeTreeBlocks: new Set(),
    worldBottomY: -32, sampleTerrainColumn: () => ({height: 4}), isWaterAt: () => false
  });
  vm.runInContext(source.slice(solidStart, solidEnd) + source.slice(heightStart, heightEnd), context);
  assert.equal(context.isSolidBlockAt(1, 4, 2), false);
  assert.equal(context.sampleTerrainHeight(1, 2), 4);
  placedBlocks.set('1,4,2', 'stone');
  context.placedColumns.get('1,2').set(4, 'stone');
  assert.equal(context.isSolidBlockAt(1, 4, 2), true);
  assert.equal(context.sampleTerrainHeight(1, 2), 5);
});

test('water mesh hides internal faces and preserves exposed sides and occupied cells', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function addWaterInstances(');
  const end = source.indexOf('        function createBlockMesh(', start);
  assert.ok(start !== -1 && end !== -1);
  const placedBlocks = new Map([['1,0,0', 'stone']]);
  const context = vm.createContext({
    THREE, waterMaterial: {}, placedBlocks, blockKey: (x, y, z) => `${x},${y},${z}`
  });
  vm.runInContext(source.slice(start, end), context);
  const group = { add(mesh) { this.mesh = mesh; } };
  context.addWaterInstances(group, [[0, -1, 0, 2], [1, -1, 0, 2], [2, -21, 0]]);
  assert.equal(group.mesh.geometry.index.count, (6 * 4 - 2 * 2) * 6);
  assert.deepEqual(Array.from(group.mesh.userData.blockRecords, row => Array.from(row)),
    [[0, -1, 0, 2], [1, -1, 0, 1], [2, -21, 0, 1]]);
  const connected = {add(mesh) { this.mesh = mesh; }};
  context.addWaterInstances(connected, [[0, 0, 0, 1]], (x, y, z) => x === 1 && y === 0 && z === 0);
  assert.equal(connected.mesh.geometry.index.count, 5 * 6);
});

test('grass and leaves use climate colors while cherry foliage keeps its texture color', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function sampleClimateColor(');
  const end = source.indexOf('        const waterCanvas', start);
  assert.ok(start !== -1 && end !== -1);
  const map = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const offset = (y * 16 + x) * 4;
      map.data.set([x * 16, y * 16, 120, 255], offset);
    }
  }
  const clamp01 = n => Math.max(0, Math.min(1, n));
  const context = vm.createContext({
    grassColorMap: map, foliageColorMap: map, clamp01,
    smoothstep: (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); }
  });
  vm.runInContext(source.slice(start, end), context);
  const warm = { temperature: 0.8, moisture: 0.8, snowWeight: 0 };
  const cool = { temperature: 0.4, moisture: 0.8, snowWeight: 0 };
  assert.notDeepEqual(Array.from(context.grassBiomeColor(warm)), Array.from(context.grassBiomeColor(cool)));
  assert.notDeepEqual(Array.from(context.foliageBiomeColor(warm, 'spruce')), Array.from(context.foliageBiomeColor(cool, 'spruce')));
  assert.deepEqual(Array.from(context.foliageBiomeColor(cool, 'cherry')), [1, 1, 1]);
  assert.deepEqual(Array.from(context.grassBiomeColor({ ...cool, snowWeight: 1 })), [208 / 255, 16 / 255, 120 / 255]);
});

test('natural trees are rendered and tracked in both near and distant chunks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function buildTerrainChunk(');
  const end = source.indexOf('        function updateTerrainChunks()', start);
  assert.ok(start !== -1 && end !== -1);
  const column = {
    height: 3, isWater: false, snowWeight: 0, surfaceType: 'grass',
    treeSpecies: 'spruce', treeDensity: 1
  };
  class Group {
    constructor() { this.children = []; }
    add(child) { this.children.push(child); }
  }
  const context = vm.createContext({
    THREE: {...THREE, Group}, camera: { updateProjectionMatrix() {} }, viewCamera: { updateProjectionMatrix() {} },
    roomId: 'test', roomSeeds: {test: 1},
    chunkSize: 32, worldBottomY: -32, waterSpreadRadius: 0,
    removedBlocks: new Set(), placedBlocks: new Map(), placedColumns: new Map(),
    sparkBlockDefinitions: new Map(),
    PixameCaves: caves,
    caveBlockTypes: ['moss_block', 'packed_ice', 'glow_mushroom', 'mushroom_stem'],
    treeSpecies: ['spruce'],
    treeBlockType: (species, part) => species === 'oak' ? part : `${species}_${part}`,
    blockKey: (x, y, z) => `${x},${y},${z}`,
    terrainColumnKey: (x, z) => `${x},${z}`,
    sampleTerrainColumn: () => column,
    grassBiomeColor: () => [1, 1, 1],
    foliageBiomeColor: () => [1, 1, 1],
    addGroupedBlock: (map, type, block) => {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(block);
    },
    addBlockInstances: (group, blocks, geometry, material, type) => {
      if (!blocks.length) return undefined;
      const mesh = { userData: { blockType: type, blockRecords: blocks }, count: blocks.length, geometry, material };
      group.add(mesh);
      return mesh;
    },
    addWaterInstances: () => {},
    blockGeo: {}, grassGeo: {}, grassMaterials: {}, grassOverlayGeo: {}, grassOverlayMaterial: {},
    dirtGeo: {}, stoneGeo: {}, ironOreGeo: {}, bedrockGeo: {}, sandGeo: {}, snowGeo: {},
    woodGeo: {}, leavesGeo: {}, leavesMaterial: {}, blockMat: {}, planksGeo: {},
    craftingTableGeo: {}, furnaceGeo: {},
    treeGeometries: { spruce: { log: {}, leaves: {} } },
    caveGeometries: {}, mediumBlockMat: {}, mediumLeavesMaterial: {},
    mediumGrassMaterials: {}, mediumGrassOverlayMaterial: {},
    shortGrassGeometry: {}, shortGrassMaterial: {}, mediumShortGrassMaterial: {}
  });
  vm.runInContext(source.slice(start, end), context);
  for (const lod of ['high', 'surface', 'medium']) {
    const chunk = context.buildTerrainChunk(0, 0, lod);
    assert.ok(chunk.treeKeys.length > 0);
    const wood = chunk.group.children.find(mesh => mesh.userData.blockType === 'spruce_wood');
    assert.ok(wood);
    assert.equal(wood.material, lod === 'medium' ? context.mediumBlockMat : context.blockMat);
    assert.ok(chunk.group.children.some(mesh => mesh.userData.foliageSpecies === 'spruce'));
    const records = new Set(wood.userData.blockRecords.map(([x, y, z]) => `${x},${y},${z}`));
    assert.ok(wood.userData.blockRecords.some(([x, y, z]) => y > 3 && !records.has(`${x},${y - 1},${z}`)));
  }
  column.treeDensity = 0.03;
  for (const species of ['oak', 'spruce', 'jungle', 'acacia', 'cherry', 'birch', 'dark_oak']) {
    column.treeSpecies = species;
    const chunk = context.buildTerrainChunk(0, 0, 'high');
    assert.ok(chunk.group.children.some(mesh => mesh.userData.blockType === context.treeBlockType(species, 'wood')));
    assert.ok(chunk.group.children.some(mesh => mesh.userData.blockType === context.treeBlockType(species, 'leaves')));
  }
  column.treeSpecies = null;
  const naturalGrass = context.buildTerrainChunk(0, 0, 'medium').group.children
    .find(mesh => mesh.userData.blockType === 'short_grass');
  assert.ok(naturalGrass?.count > 0);
  assert.equal(naturalGrass.material, context.mediumShortGrassMaterial);
  const [grassX, grassY, grassZ] = naturalGrass.userData.blockRecords[0];
  context.removedBlocks.add(`${grassX},${grassY},${grassZ}`);
  const afterRemoval = context.buildTerrainChunk(0, 0, 'medium').group.children
    .find(mesh => mesh.userData.blockType === 'short_grass');
  assert.ok(!afterRemoval.userData.blockRecords.some(([x, y, z]) => x === grassX && y === grassY && z === grassZ));
  context.placedBlocks.set(`${grassX},${grassY},${grassZ}`, 'short_grass');
  context.placedColumns.set(`${grassX},${grassZ}`, new Map([[grassY, 'short_grass']]));
  const replanted = context.buildTerrainChunk(0, 0, 'medium').group.children
    .find(mesh => mesh.userData.blockType === 'short_grass');
  assert.ok(replanted.userData.blockRecords.some(([x, y, z]) => x === grassX && y === grassY && z === grassZ));
  const iceCave = { floor: -21, ceiling: -15, biome: 'ice', water: true };
  context.caveProfileAt = () => iceCave;
  context.caveGeometries = { packed_ice: {}, moss_block: {}, mushroom_stem: {}, glow_mushroom: {} };
  context.glowMushroomMaterial = {};
  context.undergroundBlockType = () => 'stone';
  context.addWaterInstances = (group, cells) => {
    if (cells.some(([, y]) => y < -4)) group.add({ userData: { blockType: 'cave_water', blockRecords: cells }, count: cells.length });
  };
  const iceChunk = context.buildTerrainChunk(0, 0, 'high', true);
  assert.ok(iceChunk.group.children.some(mesh => mesh.userData.blockType === 'packed_ice'));
  assert.ok(iceChunk.group.children.some(mesh => mesh.userData.blockType === 'cave_water'));
  context.caveProfileAt = () => ({ floor: -21, ceiling: -15, biome: 'fungal', water: false });
  const fungalChunk = context.buildTerrainChunk(0, 0, 'high', true);
  assert.ok(fungalChunk.group.children.some(mesh => mesh.userData.blockType === 'glow_mushroom'));
});

test('seeded terrain includes flat building areas, rolling hills and curved ridges', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        let terrainSeed = roomSeeds[roomId];');
  const end = source.indexOf('        function sampleTerrainHeight(', start);
  assert.ok(start !== -1 && end !== -1);
  for (const seed of [1, 2, 3]) {
    const context = vm.createContext({ roomSeeds: { test: seed }, roomId: 'test', PixameBiomes: biomes });
    vm.runInContext(source.slice(start, end), context);
    let hills = 0;
    let water = 0;
    let maxHeight = 0;
    let flatArea = false;
    for (let x = -192; x < 192; x += 8) {
      for (let z = -192; z < 192; z += 8) {
        const column = context.sampleTerrainColumn(x, z);
        assert.deepEqual(column, context.sampleTerrainColumn(x, z));
        if (column.isWater) {
          water++;
          continue;
        }
        maxHeight = Math.max(maxHeight, column.height);
        if (column.mountainness < 0.25 && column.height >= 9) hills++;
        if (!flatArea && x % 16 === 0 && z % 16 === 0) {
          let sameHeight = true;
          for (let dx = 0; dx < 16 && sameHeight; dx++) {
            for (let dz = 0; dz < 16; dz++) {
              const next = context.sampleTerrainColumn(x + dx, z + dz);
              if (next.isWater || next.height !== column.height) { sameHeight = false; break; }
            }
          }
          flatArea = sameHeight;
        }
      }
    }
    assert.ok(flatArea, `Seed ${seed} needs a flat 16×16 building area`);
    assert.ok(hills > 100, `Seed ${seed} needs rolling hills outside mountains`);
    assert.ok(maxHeight >= 20, `Seed ${seed} needs higher terrain`);
    assert.ok(water > 0, `Seed ${seed} needs rivers`);
    const ridgePositions = [];
    for (let x = -192; x <= 192; x += 24) {
      let peak = { z: 0, mountainness: 0 };
      for (let z = -120; z <= 120; z += 2) {
        const { mountainness } = context.sampleTerrainColumn(x, z);
        if (mountainness > peak.mountainness) peak = { z, mountainness };
      }
      if (peak.mountainness >= 0.5) ridgePositions.push(peak.z);
    }
    assert.ok(ridgePositions.length >= 3 && Math.max(...ridgePositions) - Math.min(...ridgePositions) >= 10,
      `Seed ${seed} needs a winding mountain ridge`);
  }
});
