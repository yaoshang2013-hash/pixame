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

test('player model applies its 180-degree facing offset at the root', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.setFacingYaw(avatar, 0.25);
  assert.ok(Math.abs(avatar.root.rotation.y - (Math.PI + 0.25)) < 1e-8);
  avatars.update(avatar, { moving: true, forwardMove: 1 }, 0.05);
  assert.ok(Math.abs(avatar.pose.rotation.y) < 0.1);
  assert.ok(Math.abs(avatar.root.rotation.y - (Math.PI + 0.25)) < 1e-8);
});

test('player head follows the crosshair target independently of the body', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.update(avatar, {aimYaw: 0.4, aimPitch: 0.3}, 0.1);
  assert.ok(avatar.limbs.head.rotation.y > 0);
  assert.ok(avatar.limbs.head.rotation.x < 0);
});

test('model water expressions distinguish floating at the surface from underwater swimming', () => {
  const avatars = factory();
  assert.equal(avatars.waterPose(1, 0.2, 1.8, false), 'floating');
  assert.equal(avatars.waterPose(1, 0.2, 1.8, true), 'none');
  assert.equal(avatars.waterPose(1, 0.2, 0.9), 'swimming');
  assert.equal(avatars.waterPose(null, 0.2, 0.9), 'none');
  assert.equal(avatars.waterPose(1, 1, 1.8), 'none');
});

test('sprint has its own faster, leaning gait', () => {
  const avatars = factory();
  const walk = avatars.create();
  const sprint = avatars.create();
  let walkLegPeak = 0;
  let sprintLegPeak = 0;
  for (let i = 0; i < 40; i++) {
    avatars.update(walk, { moving: true }, 0.1);
    avatars.update(sprint, { moving: true, sprinting: true }, 0.1);
    walkLegPeak = Math.max(walkLegPeak, Math.abs(walk.limbs.left_leg.rotation.x));
    sprintLegPeak = Math.max(sprintLegPeak, Math.abs(sprint.limbs.left_leg.rotation.x));
  }
  assert.ok(sprint.sprintStrength > 0.9);
  assert.ok(sprint.pose.rotation.x > walk.pose.rotation.x + 0.1);
  assert.ok(sprint.phase > walk.phase * 1.4);
  assert.ok(sprintLegPeak > walkLegPeak);
});

test('forward walking and sprinting swing limbs in the corrected direction', () => {
  const avatars = factory();
  for (const [state, frames] of [
    [{ moving: true }, 20],
    [{ moving: true, sprinting: true }, 14]
  ]) {
    const avatar = avatars.create();
    for (let i = 0; i < frames; i++) avatars.update(avatar, state, 0.05);
    const cycle = Math.sin(avatar.phase);
    assert.ok(cycle > 0.5);
    assert.ok(avatar.limbs.right_leg.rotation.x * cycle > 0);
    assert.ok(avatar.limbs.left_leg.rotation.x * cycle < 0);
    assert.ok(avatar.limbs.right_arm.rotation.x * cycle < 0);
    assert.ok(avatar.limbs.left_arm.rotation.x * cycle > 0);
    assert.ok(avatar.limbs.right_arm.rotation.z > 0);
    assert.ok(avatar.limbs.left_arm.rotation.z < 0);
  }
});

test('backward and sideways movement use distinct original gaits', () => {
  const avatars = factory();
  const forward = avatars.create();
  const backward = avatars.create();
  const strafing = avatars.create();
  for (let i = 0; i < 20; i++) {
    avatars.update(forward, { moving: true, forwardMove: 1 }, 0.05);
    avatars.update(backward, { moving: true, forwardMove: -1 }, 0.05);
    avatars.update(strafing, { moving: true, strafeMove: 1 }, 0.05);
  }
  const cycle = Math.sin(forward.phase);
  assert.ok(cycle > 0.5);
  assert.ok(forward.limbs.right_leg.rotation.x * cycle > 0);
  assert.ok(backward.limbs.right_leg.rotation.x * cycle < 0);
  assert.ok(strafing.limbs.right_leg.rotation.z * cycle < 0);
  assert.ok(strafing.limbs.left_leg.rotation.z * cycle > 0);
});

test('state changes play explicit transition animations', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.update(avatar, {}, 0.05);
  avatars.update(avatar, { moving: true }, 0.05);
  assert.equal(avatar.transitionName, 'stand-to-walk');
  assert.notEqual(avatar.transitionPose.rightLeg, 0);

  avatars.update(avatar, { moving: true, sprinting: true }, 0.05);
  assert.equal(avatar.transitionName, 'walk-to-sprint');

  const falling = avatars.create();
  avatars.update(falling, { grounded: false, verticalSpeed: -4 }, 0.05);
  avatars.update(falling, { grounded: true }, 0.1);
  assert.equal(falling.transitionName, 'fall-to-land');
  assert.ok(falling.transitionPose.bob < 0);
  assert.ok(falling.transitionPose.squash < 0);
  assert.ok(falling.pose.scale.y < 1);
  assert.ok(Math.abs(falling.pose.position.y - falling.pose.scale.y) < 1e-8);
  avatars.update(falling, { grounded: true }, 0.15);
  avatars.update(falling, { grounded: true }, 0.1);
  assert.ok(falling.transitionPose.bob > 0);
});

test('jump takeoff has a brief anticipation followed by an extension', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.update(avatar, { grounded: false, verticalSpeed: 4 }, 0.05);
  assert.equal(avatar.transitionName, 'jump-takeoff');
  assert.ok(avatar.transitionPose.squash < 0);
  assert.ok(avatar.pose.scale.y < 1);

  avatars.update(avatar, { grounded: false, verticalSpeed: 4 }, 0.1);
  assert.ok(avatar.transitionPose.squash > 0);
  assert.ok(avatar.pose.scale.y > 1);
});

test('jumping, falling, and flying blend into distinct airborne poses', () => {
  const avatars = factory();
  const jumping = avatars.create();
  const falling = avatars.create();
  const flying = avatars.create();
  for (let i = 0; i < 10; i++) {
    avatars.update(jumping, { grounded: false, verticalSpeed: 4 }, 0.1);
    avatars.update(falling, { grounded: false, verticalSpeed: -4 }, 0.1);
    avatars.update(flying, { grounded: false, flying: true, verticalSpeed: 4 }, 0.1);
  }
  assert.ok(jumping.jumpStrength > 0.9);
  assert.ok(jumping.limbs.right_arm.rotation.x > 0.2);
  assert.ok(falling.fallStrength > 0.9);
  assert.ok(falling.limbs.left_arm.rotation.z < -0.08);
  assert.ok(flying.flightStrength > 0.9);
  assert.equal(flying.jumpStrength, 0);
  assert.ok(flying.limbs.left_arm.rotation.z < -0.3);
});

test('surface floating stays upright, bobs gently, and animates arms without swim strokes', () => {
  const avatars = factory();
  const avatar = avatars.create();
  for (let i = 0; i < 10; i++) avatars.update(avatar, { floating: true }, 0.1);
  assert.ok(avatar.floatStrength > 0.9);
  assert.ok(Math.abs(avatar.pose.rotation.x) < 0.2);
  assert.ok(Math.abs(avatar.pose.position.y - 1) < 0.06);
  assert.ok(Math.abs(avatar.limbs.right_arm.rotation.z) > 0.03);
  assert.equal(avatar.swimStrength, 0);
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
