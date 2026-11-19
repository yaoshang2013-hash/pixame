const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('water block meshes retain depth and skip occupied cells', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function addWaterInstances(');
  const end = source.indexOf('        function createBlockMesh(', start);
  assert.ok(start !== -1 && end !== -1);
  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; }
  }
  class Matrix {
    compose(position, rotation, scale) { this.record = { y: position.y, height: scale.y }; }
  }
  class Mesh {
    constructor(geometry, material, count) {
      this.count = count;
      this.instanceMatrix = {};
      this.records = [];
    }
    setMatrixAt(index, matrix) { this.records[index] = { ...matrix.record }; }
  }
  const placedBlocks = new Map([['1,0,0', 'stone']]);
  const context = vm.createContext({
    THREE: { Vector3: Vector, Matrix4: Matrix, Quaternion: class {}, InstancedMesh: Mesh },
    waterGeo: {}, waterMaterial: {}, placedBlocks, blockKey: (x, y, z) => `${x},${y},${z}`
  });
  vm.runInContext(source.slice(start, end), context);
  const group = { add(mesh) { this.mesh = mesh; } };
  context.addWaterInstances(group, [[0, -1, 0, 2], [1, -1, 0, 2], [2, -21, 0]]);
  assert.deepEqual(group.mesh.records, [
    { y: 0, height: 2 }, { y: -0.5, height: 1 }, { y: -20.5, height: 1 }
  ]);
});

test('grass and leaves use climate colors while cherry foliage keeps its texture color', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  const start = source.indexOf('        function sampleClimateColor(');
  const end = source.indexOf('        const lowDetailSideTiles', start);
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
    THREE: { Group }, chunkSize: 32, worldBottomY: -32, waterSpreadRadius: 0,
    removedBlocks: new Set(), placedBlocks: new Map(), placedColumns: new Map(),
    sparkBlockDefinitions: new Map(),
    PixameCaves: caves,
    caveBlockTypes: ['moss_block', 'packed_ice', 'glow_mushroom', 'mushroom_stem'],
    treeSpecies: ['spruce'],
    treeBlockType: (species, part) => species === 'oak' ? part : `${species}_${part}`,
    blockKey: (x, y, z) => `${x},${y},${z}`,
    terrainColumnKey: (x, z) => `${x},${z}`,
    sampleTerrainColumn: () => column,
    grassBiomeColor: () => [1, 1, 1], lowGrassColor: () => [1, 1, 1],
    foliageBiomeColor: () => [1, 1, 1],
    addGroupedBlock: (map, type, block) => {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(block);
    },
    addBlockInstances: (group, blocks, geometry, material, type) => {
      if (!blocks.length) return undefined;
      const mesh = { userData: { blockType: type, blockRecords: blocks }, count: blocks.length };
      group.add(mesh);
      return mesh;
    },
    addWaterInstances: () => {},
    blockGeo: {}, grassGeo: {}, grassMaterials: {}, grassOverlayGeo: {}, grassOverlayMaterial: {},
    dirtGeo: {}, stoneGeo: {}, ironOreGeo: {}, bedrockGeo: {}, sandGeo: {}, snowGeo: {},
    woodGeo: {}, leavesGeo: {}, leavesMaterial: {}, blockMat: {}, planksGeo: {},
    craftingTableGeo: {}, furnaceGeo: {},
    treeGeometries: { spruce: { log: {}, leaves: {} } },
    lowTreeMaterials: { spruce: { wood: {}, leaves: {} } },
    lowDetailMaterials: { grass: {}, wood: {}, leaves: {}, sand: {} }
  });
  vm.runInContext(source.slice(start, end), context);
  for (const lod of ['high', 'low']) {
    const chunk = context.buildTerrainChunk(0, 0, lod);
    assert.ok(chunk.treeKeys.length > 0);
    const wood = chunk.group.children.find(mesh => mesh.userData.blockType === 'spruce_wood');
    assert.ok(wood);
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
  const iceCave = { floor: -21, ceiling: -15, biome: 'ice', water: true };
  context.caveProfileAt = () => iceCave;
  context.caveGeometries = { packed_ice: {}, moss_block: {}, mushroom_stem: {}, glow_mushroom: {} };
  context.glowMushroomMaterial = {};
  context.undergroundBlockType = () => 'stone';
  context.addWaterInstances = (group, cells) => {
    if (cells.some(([, y]) => y < -4)) group.add({ userData: { blockType: 'cave_water' }, count: cells.length });
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
