(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createPlayerAvatarFactory = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (THREE, model, texture) {
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
    return { root, pose, limbs, phase: 0 };
  }

  function update(avatar, state, dt) {
    const moving = !!state.moving;
    const swimming = !!state.swimming;
    avatar.phase += dt * (swimming ? 7 : state.sprinting ? 12 : 8);
    const swing = Math.sin(avatar.phase);
    const targetPitch = swimming ? -Math.PI / 2 : 0;
    const blend = 1 - Math.exp(-10 * dt);
    avatar.pose.rotation.x += (targetPitch - avatar.pose.rotation.x) * blend;
    const armSwing = swimming ? (moving ? 0.8 : 0.2) : moving ? (state.sprinting ? 0.95 : 0.65) : 0;
    const legSwing = swimming ? (moving ? 0.55 : 0.15) : moving ? (state.sprinting ? 0.9 : 0.6) : 0;
    const targetRightArm = state.mining && !swimming ? -1.1 + swing * 0.45 : swing * armSwing;
    const targetLeftArm = -swing * armSwing;
    const idle = !moving && !state.mining && !swimming;
    avatar.limbs.head.rotation.y += ((idle ? Math.sin(avatar.phase * 0.2) * 0.04 : 0) - avatar.limbs.head.rotation.y) * blend;
    for (const [name, target] of [
      ['right_arm', targetRightArm], ['left_arm', targetLeftArm],
      ['right_leg', -swing * legSwing], ['left_leg', swing * legSwing]
    ]) {
      avatar.limbs[name].rotation.x += (target - avatar.limbs[name].rotation.x) * blend;
    }
  }

  return { create, update };
});
