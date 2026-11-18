const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const biomes = require('../biomes.js');

test('biome regions cover four by four 32-block chunks, including negative coordinates', () => {
  assert.equal(biomes.chunkSize, 32);
  assert.equal(biomes.regionSize, 128);
  for (const [regionX, regionZ] of [[0, 0], [-1, -2], [4, -3]]) {
    const first = biomes.sampleRegion(regionX * 128, regionZ * 128, 1);
    for (let x = 0; x < 128; x += 32) {
      for (let z = 0; z < 128; z += 32) {
        assert.equal(biomes.sampleRegion(regionX * 128 + x, regionZ * 128 + z, 1), first);
        assert.equal(biomes.sampleRegion(regionX * 128 + x + 31, regionZ * 128 + z + 31, 1), first);
      }
    }
  }
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
  for (const name of ['snow', 'tundra', 'taiga', 'cherry_grove', 'forest', 'meadow', 'plains', 'savanna', 'rainforest', 'desert']) {
    assert.ok(found.has(name), `Missing ${name}`);
  }
  assert.equal(new Set([...found.values()].map(region => region.temperature)).size, found.size);
  assert.equal(found.get('taiga').tree, 'spruce');
  assert.equal(found.get('rainforest').tree, 'jungle');
  assert.equal(found.get('savanna').tree, 'acacia');
  assert.equal(found.get('cherry_grove').tree, 'cherry');
  assert.equal(found.get('tundra').tree, null);
  assert.notEqual(biomes.sampleRegion(0, 0, 1), biomes.sampleRegion(0, 0, 2));
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
  const context = vm.createContext({ grassColorMap: map, foliageColorMap: map, clamp01: n => Math.max(0, Math.min(1, n)) });
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
      const mesh = { userData: { blockType: type }, count: blocks.length };
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
    assert.ok(chunk.group.children.some(mesh => mesh.userData.blockType === 'wood'));
    assert.ok(chunk.group.children.some(mesh => mesh.userData.foliageSpecies === 'spruce'));
  }
});
