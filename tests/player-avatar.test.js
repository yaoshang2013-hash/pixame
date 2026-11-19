const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const createFactory = require('../player-avatar.js');
const model = require('../player.json');

function factory() {
  return createFactory(THREE, model, { image: { width: 64, height: 64 } });
}

test('player skin is applied to separate animated body parts', () => {
  const avatars = factory();
  const first = avatars.create();
  const second = avatars.create();
  first.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(first.root);
  assert.ok(bounds.max.y > 2 && bounds.max.y < 2.1);
  assert.ok(bounds.min.y > -0.1 && bounds.min.y <= 0);
  assert.equal(first.limbs.right_arm.children.length, 2);
  assert.equal(first.limbs.right_arm.children[0].material.map.image.width, 64);
  const headUv = first.limbs.head.children[0].geometry.attributes.uv;
  assert.equal(headUv.getX(20), 8 / 64);
  assert.equal(headUv.getY(20), 1 - 8 / 64);
  assert.equal(headUv.getX(23), 16 / 64);
  assert.equal(headUv.getY(23), 1 - 16 / 64);
  avatars.update(first, { moving: true, sprinting: true }, 0.1);
  assert.notEqual(first.limbs.right_arm.rotation.x, 0);
  assert.equal(second.limbs.right_arm.rotation.x, 0);
});

test('mining and swimming poses transition independently of movement', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.update(avatar, { mining: true }, 0.1);
  assert.ok(avatar.limbs.right_arm.rotation.x < -0.3);
  for (let i = 0; i < 10; i++) avatars.update(avatar, { moving: true, swimming: true }, 0.1);
  assert.ok(avatar.pose.rotation.x < -1.5);
  assert.notEqual(avatar.limbs.left_leg.rotation.x, 0);
  for (let i = 0; i < 10; i++) avatars.update(avatar, {}, 0.1);
  assert.ok(Math.abs(avatar.pose.rotation.x) < 0.01);
  assert.ok(Math.abs(avatar.limbs.left_leg.rotation.x) < 0.01);
});

test('invalid model and mismatched skin fail explicitly', () => {
  assert.throws(() => createFactory(THREE, model, { image: { width: 32, height: 32 } }), /dimensions/);
  const incomplete = { ...model, models: model.models.filter(part => part.part !== 'head') };
  assert.throws(() => createFactory(THREE, incomplete, { image: { width: 64, height: 64 } }), /head/);
});
