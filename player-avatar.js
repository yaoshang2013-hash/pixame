(function (root, factory) {
  function waterPose(surfaceY, feetY, eyeY, grounded) {
    if (!Number.isFinite(surfaceY) || !Number.isFinite(feetY) || feetY >= surfaceY) return 'none';
    if (eyeY < surfaceY) return 'swimming';
    return grounded ? 'none' : 'floating';
  }
  factory.waterPose = waterPose;
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    root.createPlayerAvatarFactory = factory;
    root.playerWaterPose = waterPose;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlayerAvatarFactory(THREE, model, texture) {
  const required = ['head', 'headwear', 'body', 'jacket', 'right_arm', 'right_sleeve',
    'left_arm', 'left_sleeve', 'right_leg', 'right_pants', 'left_leg', 'left_pants'];
  if (!model || !Array.isArray(model.models) || !Array.isArray(model.textureSize) ||
      model.textureSize.length !== 2 || !texture.image ||
      texture.image.width !== model.textureSize[0] || texture.image.height !== model.textureSize[1]) {
    throw new Error('Player model and skin dimensions do not match.');
  }
  const parts = new Map(model.models.map(part => [part.part, part]));
  const [textureWidth, textureHeight] = model.textureSize;
  texture.encoding = THREE.sRGBEncoding;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.5 });
  const geometries = new Map();
  const transitionChannels = ['pitch', 'roll', 'bob', 'squash', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
  const standToWalk = {
    name: 'stand-to-walk',
    duration: 0.36,
    keyframes: [
      { time: 0 },
      { time: 0.42, pitch: 0.08, rightArm: -0.14, leftArm: 0.14, rightLeg: 0.2, leftLeg: -0.16, bob: 0.018 },
      { time: 1 }
    ]
  };
  const walkToStand = {
    name: 'walk-to-stand',
    duration: 0.32,
    keyframes: [
      { time: 0 },
      { time: 0.45, pitch: -0.06, rightArm: 0.12, leftArm: -0.12, rightLeg: -0.16, leftLeg: 0.18, bob: -0.02 },
      { time: 1 }
    ]
  };
  const walkToSprint = {
    name: 'walk-to-sprint',
    duration: 0.34,
    keyframes: [
      { time: 0 },
      { time: 0.38, pitch: 0.15, rightArm: -0.22, leftArm: 0.22, rightLeg: 0.25, leftLeg: -0.25, bob: 0.025 },
      { time: 1 }
    ]
  };
  const sprintToWalk = {
    name: 'sprint-to-walk',
    duration: 0.38,
    keyframes: [
      { time: 0 },
      { time: 0.4, pitch: -0.1, rightArm: 0.14, leftArm: -0.14, rightLeg: -0.18, leftLeg: 0.18, bob: -0.018 },
      { time: 1 }
    ]
  };
  const landing = {
    name: 'fall-to-land',
    duration: 0.5,
    keyframes: [
      { time: 0 },
      { time: 0.2, pitch: 0.16, squash: -0.14, rightArm: -0.2, leftArm: -0.2, rightLeg: 0.3, leftLeg: 0.3, bob: -0.085 },
      { time: 0.55, pitch: -0.06, squash: 0.035, rightArm: 0.1, leftArm: 0.1, rightLeg: -0.08, leftLeg: -0.08, bob: 0.03 },
      { time: 0.78, pitch: 0.025, squash: -0.015, rightArm: -0.025, leftArm: -0.025, rightLeg: 0.035, leftLeg: 0.035, bob: -0.012 },
      { time: 1 }
    ]
  };
  const enteringWater = {
    name: 'enter-water',
    duration: 0.42,
    keyframes: [
      { time: 0 },
      { time: 0.38, pitch: -0.14, roll: 0.08, rightArm: -0.2, leftArm: -0.2, bob: -0.025 },
      { time: 1 }
    ]
  };
  const leavingWater = {
    name: 'leave-water',
    duration: 0.36,
    keyframes: [
      { time: 0 },
      { time: 0.4, pitch: 0.12, roll: -0.06, rightArm: 0.12, leftArm: 0.12, bob: 0.02 },
      { time: 1 }
    ]
  };
  const transitions = {
    'idle>walk': standToWalk,
    'walk>idle': walkToStand,
    'walk>sprint': walkToSprint,
    'sprint>walk': sprintToWalk,
    'jump>fall': {
      name: 'jump-to-fall',
      duration: 0.24,
      keyframes: [
        { time: 0 },
        { time: 0.5, pitch: -0.08, rightArm: -0.12, leftArm: -0.12, rightLeg: 0.12, leftLeg: 0.12 },
        { time: 1 }
      ]
    },
    'fall>idle': landing,
    'fall>walk': landing,
    'idle>swim': enteringWater,
    'walk>swim': enteringWater,
    'sprint>swim': enteringWater,
    'swim>idle': leavingWater,
    'swim>walk': leavingWater,
    'float>idle': leavingWater
  };

  function sampleTransition(clip, progress) {
    const time = Math.max(0, Math.min(1, progress));
    let start = clip.keyframes[0];
    let end = clip.keyframes[clip.keyframes.length - 1];
    for (let index = 0; index < clip.keyframes.length - 1; index++) {
      if (time <= clip.keyframes[index + 1].time) {
        start = clip.keyframes[index];
        end = clip.keyframes[index + 1];
        break;
      }
    }
    const segment = (time - start.time) / Math.max(end.time - start.time, 0.0001);
    const eased = segment * segment * (3 - 2 * segment);
    return Object.fromEntries(transitionChannels.map(channel => [
      channel,
      (start[channel] || 0) + ((end[channel] || 0) - (start[channel] || 0)) * eased
    ]));
  }

  for (const name of required) {
    const part = parts.get(name);
    const box = part && Array.isArray(part.boxes) && part.boxes[0];
    if (!box || !Array.isArray(box.coordinates) || box.coordinates.length !== 6 ||
        !Array.isArray(box.textureOffset) || box.textureOffset.length !== 2 ||
        !box.coordinates.every(Number.isFinite) || !box.textureOffset.every(Number.isFinite)) {
      throw new Error(`Invalid player model part: ${name}`);
    }
    const [x, y, z, width, height, depth] = box.coordinates;
    if (width <= 0 || height <= 0 || depth <= 0 || (box.sizeAdd !== undefined && !Number.isFinite(box.sizeAdd))) {
      throw new Error(`Invalid player model dimensions: ${name}`);
    }
    const inflate = box.sizeAdd || 0;
    const geometry = new THREE.BoxGeometry(width + 2 * inflate, height + 2 * inflate, depth + 2 * inflate);
    const [u, v] = box.textureOffset;
    const faces = [
      [u + depth + width, v + depth, depth, height],
      [u, v + depth, depth, height],
      [u + depth, v, width, depth],
      [u + depth + width, v, width, depth],
      [u + depth + width + depth, v + depth, width, height],
      [u + depth, v + depth, width, height]
    ];
    const uv = geometry.attributes.uv;
    faces.forEach(([left, top, faceWidth, faceHeight], face) => {
      const u0 = left / textureWidth;
      const u1 = (left + faceWidth) / textureWidth;
      const v0 = 1 - top / textureHeight;
      const v1 = 1 - (top + faceHeight) / textureHeight;
      uv.setXY(face * 4, u0, v0);
      uv.setXY(face * 4 + 1, u1, v0);
      uv.setXY(face * 4 + 2, u0, v1);
      uv.setXY(face * 4 + 3, u1, v1);
    });
    geometries.set(name, { geometry, center: [x + width / 2, y + height / 2, z + depth / 2], top: y + height });
  }

  function create() {
    const root = new THREE.Group();
    const pose = new THREE.Group();
    pose.position.y = 1;
    root.add(pose);
    const limbs = {};
    for (const [base, overlay] of [
      ['head', 'headwear'], ['body', 'jacket'], ['right_arm', 'right_sleeve'],
      ['left_arm', 'left_sleeve'], ['right_leg', 'right_pants'], ['left_leg', 'left_pants']
    ]) {
      const data = geometries.get(base);
      const pivot = new THREE.Group();
      const pivotY = base.endsWith('_arm') ? data.top - 2
        : base.endsWith('_leg') ? data.top : base === 'head' ? data.center[1] - 4 : data.center[1];
      pivot.position.set(data.center[0] / 16, (pivotY - 16) / 16, data.center[2] / 16);
      pose.add(pivot);
      for (const name of [base, overlay]) {
        const part = geometries.get(name);
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.position.set(
          (part.center[0] - data.center[0]) / 16,
          (part.center[1] - pivotY) / 16,
          (part.center[2] - data.center[2]) / 16
        );
        mesh.scale.setScalar(1 / 16);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pivot.add(mesh);
      }
      limbs[base] = pivot;
    }
    return {
      root, pose, limbs, phase: 0, mode: 'idle', activeTransition: null,
      transitionElapsed: 0, transitionName: null, transitionPose: {},
      walkStrength: 0, sprintStrength: 0,
      jumpStrength: 0, fallStrength: 0, flightStrength: 0,
      miningStrength: 0, swimStrength: 0, floatStrength: 0
    };
  }

  function update(avatar, state, dt) {
    const delta = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const moving = !!state.moving;
    const rawForwardMove = Number.isFinite(state.forwardMove) ? state.forwardMove : (moving ? 1 : 0);
    const rawStrafeMove = Number.isFinite(state.strafeMove) ? state.strafeMove : 0;
    const inputLength = Math.hypot(rawForwardMove, rawStrafeMove);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const forwardMove = rawForwardMove * inputScale;
    const strafeMove = rawStrafeMove * inputScale;
    const swimming = !!state.swimming;
    const floating = !!state.floating && !swimming;
    const flying = !!state.flying && !swimming;
    const airborne = state.grounded === false && !swimming && !floating && !flying;
    const verticalSpeed = Number.isFinite(state.verticalSpeed) ? state.verticalSpeed : 0;
    const sprinting = moving && !!state.sprinting && !swimming && !floating && !airborne;
    const walking = moving && !sprinting && !swimming && !floating && !airborne;
    const jumping = airborne && verticalSpeed > 0.35;
    const falling = airborne && verticalSpeed < -0.35;
    const mode = swimming ? 'swim' : floating ? 'float' : flying ? 'flight'
      : jumping ? 'jump' : falling ? 'fall' : airborne ? 'air'
        : sprinting ? 'sprint' : walking ? 'walk' : 'idle';
    if (mode !== avatar.mode) {
      avatar.activeTransition = transitions[`${avatar.mode}>${mode}`] || null;
      avatar.transitionElapsed = 0;
      avatar.transitionName = avatar.activeTransition ? avatar.activeTransition.name : null;
      avatar.mode = mode;
    }
    let transitionPose = {};
    if (avatar.activeTransition) {
      avatar.transitionElapsed += delta;
      transitionPose = sampleTransition(
        avatar.activeTransition,
        avatar.transitionElapsed / avatar.activeTransition.duration
      );
      if (avatar.transitionElapsed >= avatar.activeTransition.duration) {
        avatar.activeTransition = null;
        avatar.transitionName = null;
      }
    }
    avatar.transitionPose = transitionPose;
    const transition = 1 - Math.exp(-14 * delta);
    avatar.walkStrength += ((walking ? 1 : 0) - avatar.walkStrength) * transition;
    avatar.sprintStrength += ((sprinting ? 1 : 0) - avatar.sprintStrength) * transition;
    avatar.jumpStrength += ((jumping ? 1 : 0) - avatar.jumpStrength) * transition;
    avatar.fallStrength += ((falling ? 1 : 0) - avatar.fallStrength) * transition;
    avatar.flightStrength += ((flying ? 1 : 0) - avatar.flightStrength) * transition;
    avatar.miningStrength += ((state.mining && !swimming && !floating ? 1 : 0) - avatar.miningStrength) * transition;
    avatar.swimStrength += ((swimming ? 1 : 0) - avatar.swimStrength) * transition;
    avatar.floatStrength += ((floating ? 1 : 0) - avatar.floatStrength) * transition;

    const walk = avatar.walkStrength;
    const run = avatar.sprintStrength;
    const jump = avatar.jumpStrength;
    const fall = avatar.fallStrength;
    const flight = avatar.flightStrength;
    const swim = avatar.swimStrength;
    const float = avatar.floatStrength;
    const mining = avatar.miningStrength;
    const idle = 1 - Math.max(walk, run, jump, fall, flight, swim, float, mining);
    const cycleRate = swim ? 6.5 : float ? (moving ? 4.5 : 1.4) : run ? 12.5 : walk ? 8.5 : flight ? 3 : 1.1;
    avatar.phase += delta * cycleRate;
    const cycle = Math.sin(avatar.phase);
    const swimCycle = Math.sin(avatar.phase + Math.sin(avatar.phase * 2) * 0.28);
    const breath = Math.sin(avatar.phase * 0.45);

    const targetPitch = -Math.PI / 2 * swim - 0.1 * float + 0.22 * run + 0.16 * jump - 0.1 * fall + 0.08 * flight +
      Math.max(0, -forwardMove) * 0.08 * walk +
      (transitionPose.pitch || 0);
    avatar.pose.rotation.x += (targetPitch - avatar.pose.rotation.x) * transition;
    const targetYaw = cycle * 0.025 * (run + float) + Math.sin(avatar.phase * 0.35) * 0.018 * walk +
      strafeMove * 0.07 * (walk + run);
    avatar.pose.rotation.y += (targetYaw - avatar.pose.rotation.y) * transition;
    const targetRoll = cycle * (0.035 * run + 0.025 * walk) + Math.sin(avatar.phase * 0.5) * 0.04 * float -
      strafeMove * 0.1 * (walk + run) +
      (transitionPose.roll || 0);
    avatar.pose.rotation.z += (targetRoll - avatar.pose.rotation.z) * transition;
    const bob = Math.abs(cycle) * (0.014 * walk + 0.026 * run) +
      swim * (0.008 + Math.abs(swimCycle) * (moving ? 0.018 : 0.006)) +
      float * (0.018 + breath * 0.022) + idle * breath * 0.006 + flight * breath * 0.008 + jump * 0.02 - fall * 0.012 +
      (transitionPose.bob || 0);
    const targetScaleY = 1 + (transitionPose.squash || 0);
    avatar.pose.scale.y += (targetScaleY - avatar.pose.scale.y) * transition;
    avatar.pose.position.y += (targetScaleY + Math.max(0, bob) - avatar.pose.position.y) * transition;

    const armSwing = -cycle * (0.58 * walk + 0.92 * run) * forwardMove;
    const sideArmSwing = cycle * (0.16 * walk + 0.2 * run) * strafeMove;
    const swimArm = Math.sin(avatar.phase + Math.sin(avatar.phase * 2) * 0.25);
    const floatStroke = moving ? Math.sin(avatar.phase * 0.7) * 0.2 : Math.sin(avatar.phase * 0.5) * 0.04;
    const rightArmX = armSwing * (1 - swim) + swim * (-0.65 + swimArm * 0.62) +
      float * (-0.12 + floatStroke) + mining * (-1.05 + Math.sin(avatar.phase * 2) * 0.32) +
      0.38 * jump - 0.25 * fall - 0.18 * flight + sideArmSwing + (transitionPose.rightArm || 0);
    const leftArmX = -armSwing * (1 - swim) + swim * (-0.65 - swimArm * 0.62) +
      float * (-0.12 - floatStroke) + 0.38 * jump - 0.25 * fall - 0.18 * flight - sideArmSwing +
      (transitionPose.leftArm || 0);
    const armSplay = 0.035 * walk + 0.07 * run + 0.06 * float + 0.12 * fall + 0.48 * flight +
      (moving ? 0 : 0.04 * swim);
    const rightArmZ = armSplay + sideArmSwing;
    const leftArmZ = -armSplay - sideArmSwing;
    const legKick = swim * (moving ? 0.38 : 0.16);
    const floatKick = float * (moving ? 0.22 : 0.08);
    const rightLegX = cycle * (0.62 * walk + 0.95 * run) * forwardMove + Math.sin(avatar.phase + Math.PI) * legKick +
      Math.sin(avatar.phase * 0.6) * floatKick - 0.18 * jump + 0.22 * fall - 0.08 * flight +
      (transitionPose.rightLeg || 0);
    const leftLegX = -cycle * (0.62 * walk + 0.95 * run) * forwardMove + Math.sin(avatar.phase) * legKick +
      Math.sin(avatar.phase * 0.6 + Math.PI) * floatKick - 0.18 * jump + 0.22 * fall - 0.08 * flight +
      (transitionPose.leftLeg || 0);
    const sideLegSwing = cycle * (0.24 * walk + 0.3 * run) * strafeMove;
    const legSplay = 0.025 * walk + 0.05 * run + 0.12 * fall + 0.05 * flight;
    const headNod = idle * breath * 0.035 - run * 0.045 * Math.abs(cycle);
    for (const [name, x, y, z] of [
      ['right_arm', rightArmX, swim * Math.sin(avatar.phase + 0.5) * 0.12, rightArmZ],
      ['left_arm', leftArmX, -swim * Math.sin(avatar.phase + 0.5) * 0.12, leftArmZ],
      ['right_leg', rightLegX, 0, legSplay - sideLegSwing],
      ['left_leg', leftLegX, 0, -legSplay + sideLegSwing],
      ['head', headNod, 0, 0]
    ]) {
      const limb = avatar.limbs[name];
      limb.rotation.x += (x - limb.rotation.x) * transition;
      limb.rotation.y += (y - limb.rotation.y) * transition;
      limb.rotation.z += (z - limb.rotation.z) * transition;
    }
  }

  return { create, update, waterPose: createPlayerAvatarFactory.waterPose };
});
