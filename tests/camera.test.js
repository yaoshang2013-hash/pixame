const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('three');

const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const aimStart = source.indexOf('        function findAimedBlock()');
const aimEnd = source.indexOf('        let furnaceBreakPending = false;', aimStart);
const localAimStart = source.indexOf('        function updateLocalAvatarAim(target)');
const localAimEnd = source.indexOf('        const viewDirection', localAimStart);
const start = source.indexOf('        function updateThirdPersonFollow(dt)');
const end = source.indexOf("        window.addEventListener('keydown'", start);
assert.ok(aimStart !== -1 && aimEnd !== -1 && localAimStart !== -1 &&
  localAimEnd !== -1 && start !== -1 && end !== -1);

function cameraContext(mode, pitch, yaw, obstructionDistance) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(12, 8, -9);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const viewCamera = new THREE.PerspectiveCamera();
  const root = new THREE.Group();
  const context = vm.createContext({
    THREE, camera, viewCamera, playerAvatar: { root }, playerEyeHeight: 1.8,
    perspectiveModes: ['first', 'thirdBack', 'thirdFront'], perspectiveModeIndex: mode,
    thirdPersonYaw: yaw, previousPerspectiveMode: ['first', 'thirdBack', 'thirdFront'][mode],
    shoulderOffset: 0.85, shoulderHeightOffset: 0.35,
    thirdPersonAimHeight: 1.5,
    gameSettings: { shoulderSide: 'right' },
    avatarFactory: { setFacingYaw() {} },
    heldItemModel: {}, playerInventoryOpen: false, workbenchOpen: false, furnaceOpen: false,
    blockPalette: { hidden: true }, document: { getElementById: () => ({ hidden: true }) },
    look: { pitch, yaw }, chunkSize: 32, terrainChunks: new Map([['0,-1', { group: {} }]]),
    viewDirection: new THREE.Vector3(), viewRight: new THREE.Vector3(), viewTarget: new THREE.Vector3(),
    viewRayDirection: new THREE.Vector3(),
    viewRaycaster: { set() {}, intersectObjects: () => obstructionDistance === undefined ? [] : [{ distance: obstructionDistance }] }
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('third-person cameras remain aimed at the player at all vertical angles', () => {
  for (const mode of [1, 2]) for (const pitch of [-1.4, -0.7, 0, 0.7, 1.4]) {
    for (const obstructionDistance of [undefined, 2]) {
      const context = cameraContext(mode, pitch, 0.8, obstructionDistance);
      const view = context.updatePerspectiveCamera();
      const direction = view.getWorldDirection(new THREE.Vector3());
      const towardPlayer = context.viewTarget.clone().sub(view.position).normalize();
      assert.ok(direction.dot(towardPlayer) > 0.999999, `mode=${mode} pitch=${pitch} obstruction=${obstructionDistance}`);
      const expectedY = Math.sin(pitch) * (mode === 1 ? -1 : 1);
      assert.ok(Math.abs(context.viewRayDirection.y - expectedY) < 1e-10);
    }
  }
});

test('first-person view hides the player model and returns the original camera', () => {
  const context = cameraContext(0, 0.7, 0.8);
  assert.equal(context.updatePerspectiveCamera(), context.camera);
  assert.equal(context.playerAvatar.root.visible, false);
  assert.equal(context.heldItemModel.visible, true);
});

test('third-person camera yaw smoothly follows the player while first person stays immediate', () => {
  const thirdPerson = cameraContext(1, 0, 0);
  thirdPerson.look.yaw = 1;
  thirdPerson.updateThirdPersonFollow(0.1);
  assert.ok(thirdPerson.thirdPersonYaw > 0 && thirdPerson.thirdPersonYaw < 1);

  const firstPerson = cameraContext(0, 0, 0);
  firstPerson.look.yaw = 1;
  firstPerson.updateThirdPersonFollow(0.1);
  assert.equal(firstPerson.thirdPersonYaw, 1);
});

test('shoulder selection offsets the camera target to opposite sides', () => {
  const context = cameraContext(1, 0, 0);
  context.updatePerspectiveCamera();
  const rightShoulderX = context.viewTarget.x;
  assert.equal(context.viewTarget.y, 8 - 1.8 + 1.5);
  assert.ok(Math.abs(
    context.viewCamera.position.y - context.viewTarget.y - context.shoulderHeightOffset
  ) < 1e-10);
  context.gameSettings.shoulderSide = 'left';
  context.updatePerspectiveCamera();
  assert.ok(Math.abs((rightShoulderX - context.viewTarget.x) - 1.7) < 1e-10);
});

test('aim camera matches the selected rendered perspective', () => {
  const firstPerson = cameraContext(0, 0.2, 0.4);
  assert.equal(firstPerson.getAimCamera(), firstPerson.camera);

  const thirdPerson = cameraContext(2, 0.2, 0.4);
  assert.equal(thirdPerson.getAimCamera(), thirdPerson.viewCamera);
});

test('third-person block aiming extends reach beyond the camera offset', () => {
  const camera = new THREE.PerspectiveCamera();
  const viewCamera = new THREE.PerspectiveCamera();
  viewCamera.position.set(0, 1.5, -4.8);
  const context = vm.createContext({
    THREE, camera, viewCamera,
    screenCenter: new THREE.Vector2(),
    getAimCamera: () => viewCamera,
    viewTarget: new THREE.Vector3(0, 1.5, 0),
    blockReach: 5,
    blockRaycaster: { setFromCamera() {}, intersectObjects: () => [] },
    terrainChunks: new Map(), chunkSize: 32, worldBottomY: -64
  });
  vm.runInContext(source.slice(aimStart, aimEnd), context);
  context.findAimedBlock();
  assert.ok(Math.abs(context.blockRaycaster.far - 9.8) < 1e-10);
  context.getAimCamera = () => camera;
  context.findAimedBlock();
  assert.equal(context.blockRaycaster.far, 5);
});

test('local head aim angles follow the actual block hit point', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.8, 0);
  const context = vm.createContext({
    camera, look: {yaw: 0, pitch: 0}, localAimYaw: 0, localAimPitch: 0
  });
  vm.runInContext(source.slice(localAimStart, localAimEnd), context);
  context.updateLocalAvatarAim({aimPoint: {x: -3, y: 3, z: -4}});
  assert.ok(Math.abs(context.localAimYaw - Math.atan2(3, 4)) < 1e-10);
  assert.ok(Math.abs(context.localAimPitch - Math.atan2(1.2, 5)) < 1e-10);
});
