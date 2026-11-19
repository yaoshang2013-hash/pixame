const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const THREE = require('three');

const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const start = source.indexOf('        function updatePerspectiveCamera()');
const end = source.indexOf("        window.addEventListener('keydown'", start);
assert.ok(start !== -1 && end !== -1);

function cameraContext(mode, pitch, yaw, obstructionDistance) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(12, 8, -9);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  const viewCamera = new THREE.PerspectiveCamera();
  const root = new THREE.Group();
  const context = vm.createContext({
    THREE, camera, viewCamera, playerAvatar: { root }, playerEyeHeight: 1.8,
    perspectiveModes: ['first', 'thirdBack', 'thirdFront'], perspectiveModeIndex: mode,
    heldItemModel: {}, playerInventoryOpen: false, workbenchOpen: false, furnaceOpen: false,
    blockPalette: { hidden: true }, document: { getElementById: () => ({ hidden: true }) },
    look: { pitch, yaw }, chunkSize: 32, terrainChunks: new Map([['0,-1', { group: {} }]]),
    viewDirection: new THREE.Vector3(), viewTarget: new THREE.Vector3(),
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
