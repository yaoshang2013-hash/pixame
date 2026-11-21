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

test('first-person arm reuses the player skin and sleeve overlay', () => {
  const avatars = factory();
  const arm = avatars.createFirstPersonArm();
  assert.equal(arm.children.length, 2);
  assert.ok(Math.abs(arm.position.length()) < 1e-8);
  for (const mesh of arm.children) {
    assert.equal(mesh.material.map.image.width, 64);
  }
});

test('first-person avatar writes neither color nor depth but still casts shadows', () => {
  const avatars = factory();
  const avatar = avatars.create();
  const mesh = avatar.limbs.head.children[0];
  const original = mesh.material;
  avatars.setShadowOnly(avatar, true);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.material.colorWrite, false);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.map, original.map);
  avatars.setShadowOnly(avatar, false);
  assert.equal(mesh.material, original);
});

test('player model faces the same direction as the camera yaw', () => {
  const avatars = factory();
  const avatar = avatars.create();
  const yaw = 0.25;
  avatars.setFacingYaw(avatar, yaw);
  const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(avatar.root.quaternion);
  const expected = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  assert.ok(facing.distanceTo(expected) < 1e-8);
  avatars.update(avatar, { moving: true, forwardMove: 1 }, 0.05);
  assert.ok(Math.abs(avatar.pose.rotation.y) < 0.1);
  assert.ok(Math.abs(avatar.root.rotation.y - yaw) < 1e-8);
});

test('player head rotates toward the crosshair target in world space', () => {
  const avatars = factory();
  const avatar = avatars.create();
  const targetDirection = new THREE.Vector3(-0.2, 0.3, -1).normalize();
  avatars.setFacingYaw(avatar, 0.4);
  for (let frame = 0; frame < 40; frame++) {
    avatars.update(avatar, {aimDirection: targetDirection}, 0.1);
  }
  const headDirection = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(avatar.limbs.head.quaternion)
    .applyQuaternion(avatar.pose.quaternion)
    .applyQuaternion(avatar.root.quaternion);
  assert.ok(headDirection.dot(targetDirection) > 0.9999);
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
  assert.ok(sprint.pose.rotation.x < walk.pose.rotation.x - 0.08);
  assert.ok(sprint.phase > walk.phase * 1.4);
  assert.ok(sprintLegPeak > walkLegPeak);
});

test('running holds the leading leg upright and lifts the trailing leg behind', () => {
  const avatars = factory();
  const avatar = avatars.create();
  let rightLeading = false, leftLeading = false;
  for (let i = 0; i < 400; i++) {
    avatars.update(avatar, {moving: true, forwardMove: 1, sprinting: true, grounded: true}, 0.01);
    if (i < 100) continue;
    const cycle = Math.sin(avatar.phase);
    const right = avatar.pose.rotation.x + avatar.limbs.right_leg.rotation.x;
    const left = avatar.pose.rotation.x + avatar.limbs.left_leg.rotation.x;
    if (cycle > 0.92 && Math.cos(avatar.phase) < 0 && Math.abs(right) < 0.18 && left < -0.65) rightLeading = true;
    if (cycle < -0.92 && Math.cos(avatar.phase) > 0 && Math.abs(left) < 0.18 && right < -0.65) leftLeading = true;
  }
  assert.ok(rightLeading && leftLeading);
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

test('sprint braking has a distinct pose and stops when movement resumes', () => {
  const avatars = factory();
  const avatar = avatars.create();
  for (let i = 0; i < 15; i++) avatars.update(avatar, {moving: true, sprinting: true, grounded: true}, 0.05);
  avatars.update(avatar, {moving: false, braking: true, grounded: true}, 0.05);
  assert.equal(avatar.mode, 'brake');
  assert.equal(avatar.transitionName, 'sprint-brake');
  assert.ok(avatar.transitionPose.pitch > 0);
  avatars.update(avatar, {moving: true, sprinting: true, grounded: true}, 0.05);
  assert.equal(avatar.mode, 'sprint');
  assert.notEqual(avatar.transitionName, 'sprint-brake');
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

test('landing contracts limbs immediately even after a long fall', () => {
  const avatars = factory();
  for (const priorSpeed of [-6, 0, 4]) {
    const avatar = avatars.create();
    for (let i = 0; i < 20; i++) avatars.update(avatar, {grounded: false, verticalSpeed: priorSpeed}, 0.05);
    const before = Math.abs(avatar.limbs.right_arm.rotation.z);
    avatars.update(avatar, {grounded: true}, 0.05);
    assert.equal(avatar.transitionName, 'fall-to-land');
    assert.ok(Math.abs(avatar.limbs.right_arm.rotation.z) < before);
    assert.ok(avatar.transitionPose.squash < 0);
  }
});

test('wall impacts, wall sliding and head bumps trigger distinct reactions', () => {
  const avatars = factory();
  const idle = avatars.create();
  const bump = avatars.create();
  const head = avatars.create();
  for (let i = 0; i < 3; i++) {
    avatars.update(idle, {grounded: true}, 0.05);
    avatars.update(bump, {grounded: true, wallContact: 'hit'}, 0.05);
    avatars.update(head, {grounded: false, verticalSpeed: 0, headHit: true}, 0.05);
  }
  assert.ok(bump.pose.rotation.x < idle.pose.rotation.x - 0.1);
  assert.ok(head.limbs.head.rotation.x < -0.1);
  assert.ok(head.limbs.right_arm.rotation.x < -0.1);
  const left = avatars.create(), right = avatars.create();
  for (let i = 0; i < 12; i++) {
    avatars.update(left, {moving: true, wallContact: 'slide', wallSide: -1}, 0.05);
    avatars.update(right, {moving: true, wallContact: 'slide', wallSide: 1}, 0.05);
  }
  assert.ok(right.pose.rotation.z > left.pose.rotation.z + 0.2);
});

test('jump takeoff has a brief anticipation followed by an extension', () => {
  const avatars = factory();
  const avatar = avatars.create();
  avatars.update(avatar, { grounded: false, verticalSpeed: 4 }, 0.05);
  assert.equal(avatar.transitionName, 'jump-takeoff');
  assert.ok(avatar.transitionPose.squash < 0);
  assert.ok(avatar.transitionPose.rightArmSplay < 0);
  assert.ok(avatar.pose.scale.y < 1);

  avatars.update(avatar, { grounded: false, verticalSpeed: 4 }, 0.1);
  assert.ok(avatar.transitionPose.squash > 0);
  assert.ok(avatar.transitionPose.rightArmSplay > 0);
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
  assert.ok(jumping.limbs.right_arm.rotation.z > 0.2);
  assert.ok(jumping.limbs.left_arm.rotation.z < -0.2);
  assert.ok(jumping.limbs.right_leg.rotation.z > 0.1);
  assert.ok(jumping.limbs.left_leg.rotation.z < -0.1);
  assert.ok(falling.fallStrength > 0.9);
  assert.ok(falling.limbs.left_arm.rotation.z < -0.55);
  assert.ok(falling.limbs.right_leg.rotation.z > 0.3);
  assert.ok(flying.flightStrength > 0.9);
  assert.equal(flying.jumpStrength, 0);
  assert.ok(flying.limbs.left_arm.rotation.z < -0.3);
});

test('airborne apex keeps the limbs spread as vertical speed approaches zero', () => {
  const avatars = factory();
  const avatar = avatars.create();
  for (let i = 0; i < 10; i++) avatars.update(avatar, { grounded: false, verticalSpeed: 0 }, 0.1);
  assert.ok(avatar.airStrength > 0.9);
  assert.ok(avatar.limbs.right_arm.rotation.z > 0.3);
  assert.ok(avatar.limbs.left_leg.rotation.z < -0.2);
});

test('airborne legs scissor in opposite directions instead of hanging symmetrically', () => {
  const avatars = factory();
  const jumping = avatars.create();
  const falling = avatars.create();
  for (let i = 0; i < 3; i++) {
    avatars.update(jumping, { grounded: false, verticalSpeed: 4 }, 0.1);
    avatars.update(falling, { grounded: false, verticalSpeed: -4 }, 0.1);
  }
  assert.ok(jumping.limbs.right_leg.rotation.x > jumping.limbs.left_leg.rotation.x + 0.18);
  assert.ok(falling.limbs.right_leg.rotation.x > falling.limbs.left_leg.rotation.x + 0.2);
});

test('falling limb wobble responds to fall speed and drop height', () => {
  const avatars = factory();
  function measureWobble(speed, groundDistance) {
    const avatar = avatars.create();
    const ranges = { arms: [Infinity, -Infinity], legs: [Infinity, -Infinity] };
    for (let i = 0; i < 60; i++) {
      avatars.update(avatar, { grounded: false, verticalSpeed: speed, groundDistance }, 0.05);
      if (i < 12) continue;
      const differences = [
        avatar.limbs.right_arm.rotation.x - avatar.limbs.left_arm.rotation.x,
        avatar.limbs.right_leg.rotation.x - avatar.limbs.left_leg.rotation.x
      ];
      for (let i = 0; i < differences.length; i++) {
        const range = ranges[i === 0 ? 'arms' : 'legs'];
        range[0] = Math.min(range[0], differences[i]);
        range[1] = Math.max(range[1], differences[i]);
      }
    }
    return {
      arms: ranges.arms[1] - ranges.arms[0],
      legs: ranges.legs[1] - ranges.legs[0]
    };
  }
  const gentle = measureWobble(-0.8, 10);
  const fast = measureWobble(-8, 10);
  const shortDrop = measureWobble(-6, 3);
  const highDrop = measureWobble(-6, 8);
  assert.ok(gentle.arms > 0.03);
  assert.ok(gentle.legs > 0.03);
  assert.ok(fast.arms > gentle.arms * 2);
  assert.ok(fast.legs > gentle.legs * 2);
  assert.ok(shortDrop.arms < highDrop.arms * 0.3);
  assert.ok(shortDrop.legs < highDrop.legs * 0.3);
});

test('falling braces before impact when the ground is close', () => {
  const avatars = factory();
  const nearGround = avatars.create();
  const farGround = avatars.create();
  for (let i = 0; i < 10; i++) {
    avatars.update(nearGround, { grounded: false, verticalSpeed: -6, groundDistance: 0.05 }, 0.1);
    avatars.update(farGround, { grounded: false, verticalSpeed: -6, groundDistance: 4 }, 0.1);
  }
  assert.ok(nearGround.pose.scale.y < farGround.pose.scale.y - 0.05);
  assert.ok(nearGround.limbs.right_leg.rotation.x > farGround.limbs.right_leg.rotation.x + 0.2);
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
