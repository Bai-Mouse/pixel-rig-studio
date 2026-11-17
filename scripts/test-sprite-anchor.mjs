import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const anchors = await server.ssrLoadModule('/src/utils/spriteAnchor.ts');
  const state = () => useProjectStore.getState();

  // --- pure anchor helpers ---
  const asset = { anchor: undefined, width: 32, height: 20 };
  assert.deepEqual(anchors.effectiveSpriteAnchor(asset, { x: 16, y: 10 }), { x: 16, y: 10 }, 'sprites without an anchor follow the node pivot');
  assert.deepEqual(anchors.effectiveSpriteAnchor({ anchor: { x: 40, y: -5 }, width: 32, height: 20 }, { x: 0, y: 0 }), { x: 32, y: 0 }, 'custom anchors are clamped to the sprite');
  assert.deepEqual(anchors.effectiveSpriteAnchor(null, { x: 3, y: 4 }), { x: 3, y: 4 }, 'missing assets fall back to the node pivot');
  assert.deepEqual(anchors.centerAnchor(32, 20), { x: 16, y: 10 });
  assert.deepEqual(anchors.centerAnchor(33, 21), { x: 17, y: 11 });

  const previous = { x: 10, y: 6, width: 20, height: 20 };
  const next = { x: 14, y: 2, width: 10, height: 12 };
  assert.deepEqual(anchors.remapAnchorForCrop({ x: 8, y: 4 }, previous, next), { x: 4, y: 8 }, 'anchors keep pointing at the same source pixel across crops');
  assert.deepEqual(anchors.remapAnchorForCrop({ x: 1, y: 1 }, previous, next), { x: 0, y: 5 }, 'anchors outside the new crop clamp to its edge');
  assert.deepEqual(anchors.remapAnchorForCrop({ x: 19, y: 19 }, previous, next), { x: 10, y: 12 }, 'anchors past the new crop clamp to its other edge');

  // --- store action ---
  state().createCharacterTemplateProject();
  const node = state().nodes.head;
  const assetId = node.assetIds[1];
  const originalAsset = state().assets[assetId];
  assert.equal(originalAsset.anchor, undefined);

  state().setAssetAnchor(assetId, { x: 5, y: 6 });
  assert.deepEqual(state().assets[assetId].anchor, { x: 5, y: 6 }, 'anchor stored on the sprite');
  assert.deepEqual(state().nodes.head.pivot, node.pivot, 'node pivot is untouched');
  assert.equal(state().assets[assetId].src, originalAsset.src, 'sprite pixels are untouched');

  state().setAssetAnchor(assetId, { x: 999, y: -3 });
  assert.deepEqual(state().assets[assetId].anchor, { x: originalAsset.width, y: 0 }, 'anchors clamp to the sprite bounds');

  state().undoTransform();
  assert.deepEqual(state().assets[assetId].anchor, { x: 5, y: 6 }, 'anchor edits are undoable');
  state().undoTransform();
  assert.equal(state().assets[assetId].anchor, undefined, 'undo restores the previous anchor');
  state().redoTransform();
  assert.deepEqual(state().assets[assetId].anchor, { x: 5, y: 6 }, 'anchor edits are redoable');

  state().setAssetAnchor(assetId, null);
  assert.equal(state().assets[assetId].anchor, undefined, 'anchors can be cleared back to the node pivot');

  // --- anchor survives a crop change as a content point (remap helper contract) ---
  const cropped = anchors.remapAnchorForCrop({ x: 5, y: 6 }, { x: 4, y: 85, width: 28, height: 23 }, { x: 0, y: 85, width: 20, height: 23 });
  assert.deepEqual(cropped, { x: 9, y: 6 }, 'crop remap keeps the anchored content pixel aligned');

  // --- pivot tool never moves pixels: re-anchoring compensates the node pose ---
  function matrixFor(nodeState) {
    const radians = nodeState.rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const { x: sx, y: sy } = nodeState.scale;
    return { a: cosine * sx, b: sine * sx, c: -sine * sy, d: cosine * sy, e: nodeState.position.x, f: nodeState.position.y };
  }
  function multiply(left, right) {
    return {
      a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f,
    };
  }
  function worldOf(nodeId, frame) {
    const node = state().nodes[nodeId];
    const local = matrixFor(frame.nodeStates[nodeId]);
    return node.parentId ? multiply(worldOf(node.parentId, frame), local) : local;
  }
  function pixelWorld(nodeId, frame, pixel, asset) {
    const node = state().nodes[nodeId];
    const anchor = anchors.effectiveSpriteAnchor(asset, node.pivot);
    const world = worldOf(nodeId, frame);
    const localX = pixel.x - anchor.x;
    const localY = pixel.y - anchor.y;
    return { x: world.a * localX + world.c * localY + world.e, y: world.b * localX + world.d * localY + world.f };
  }

  state().createCharacterTemplateProject();
  const head = state().nodes.head;
  const headAssetId = head.assetIds[1];
  state().setAssetAnchor(headAssetId, { x: 5, y: 6 });
  const assetBefore = structuredClone(state().assets[headAssetId]);
  const frameBefore = structuredClone(state().frames[0]);
  const samplePixel = { x: 12, y: 14 };
  const beforePixel = pixelWorld('head', frameBefore, samplePixel, assetBefore);
  const beforePosition = frameBefore.nodeStates.head.position;
  const beforeChildPosition = frameBefore.nodeStates['node-611a3118-f93c-4c25-9daf-1ae1942ad9e7'].position;
  const pivotBefore = state().nodes.head.pivot;

  state().setAssetAnchorKeepingPixels(headAssetId, 'head', { x: 15, y: 16 });
  const frameAfter = state().frames[0];
  assert.deepEqual(state().assets[headAssetId].anchor, { x: 15, y: 16 }, 're-anchor stores the new anchor');
  assert.deepEqual(state().nodes.head.pivot, pivotBefore, 'node pivot is untouched by the pivot tool');
  assert.deepEqual(frameAfter.nodeStates.head.position, { x: beforePosition.x + 10, y: beforePosition.y + 10 }, 'node pose compensates the anchor delta at rotation 0');
  assert.deepEqual(frameAfter.nodeStates['node-611a3118-f93c-4c25-9daf-1ae1942ad9e7'].position, {
    x: beforeChildPosition.x - 10, y: beforeChildPosition.y - 10,
  }, 'children keep their world position');
  const afterPixel = pixelWorld('head', frameAfter, samplePixel, state().assets[headAssetId]);
  assert.ok(Math.abs(afterPixel.x - beforePixel.x) < 1e-6 && Math.abs(afterPixel.y - beforePixel.y) < 1e-6, 'the drawn pixel does not move');

  state().undoTransform();
  assert.deepEqual(state().assets[headAssetId].anchor, { x: 5, y: 6 }, 'anchor and pose undo together');
  assert.deepEqual(state().frames[0].nodeStates.head.position, beforePosition, 'undo restores the pose');
  state().redoTransform();
  assert.deepEqual(state().assets[headAssetId].anchor, { x: 15, y: 16 }, 'redo restores the anchored pose');
  assert.deepEqual(state().frames[0].nodeStates.head.position, frameAfter.nodeStates.head.position, 'redo restores the compensation');

  console.log('Sprite anchor checks passed.');
} finally {
  await server.close();
}
