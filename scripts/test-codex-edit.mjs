import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const { applyEditPlan, parseEditPlan } = await server.ssrLoadModule('/src/codex/editPlan.ts');
  const { captureCodexProject, codexPrompt } = await server.ssrLoadModule('/src/codex/context.ts');
  const state = () => useProjectStore.getState();
  state().createCharacterTemplateProject();
  const original = captureCodexProject();
  const framePatch = (nodeId, frameNumbers, extra) => ({
    type: 'set_node_frame', nodeId, frameNumbers,
    positionX: null, positionY: null, rotation: null, scaleX: null, scaleY: null, visible: null, spriteIndex: null, sortingOrder: null, ...extra,
  });
  const plan = parseEditPlan({
    message: '生成三帧动画并添加一个空节点',
    operations: [
      { type: 'add_frames', afterFrameNumber: 1, copyFromFrameNumber: 1, count: 2 },
      framePatch('left-arm', [1, 3], { rotation: -20, sortingOrder: 9 }),
      framePatch('right-arm', [2], { rotation: 20, scaleX: -1 }),
      { type: 'add_node', nodeId: 'ai-effect', name: 'Effect', parentId: 'body', spriteIds: [] },
      { type: 'group_frames', frameNumbers: [1, 2, 3], name: 'Wave', color: '#7788ff' },
      { type: 'set_animation', fps: 8, loop: false },
    ],
  });
  const editId = state().applyCodexPlan(plan, original);
  assert.equal(state().frames.length, 3);
  assert.equal(state().frames[0].nodeStates['left-arm'].rotation, -20);
  assert.equal(state().frames[1].nodeStates['left-arm'].rotation, original.frames[0].nodeStates['left-arm'].rotation);
  assert.equal(state().frames[1].nodeStates['right-arm'].scale.x, -1);
  assert.equal(state().frames[0].group.name, 'Wave');
  assert.equal(state().nodes['ai-effect'].parentId, 'body');
  assert.equal(state().fps, 8);
  assert.equal(state().isLooping, false);
  const changed = captureCodexProject();
  state().undoTransform();
  assert.deepEqual(captureCodexProject(), original);
  state().redoTransform();
  assert.deepEqual(captureCodexProject(), changed);
  assert.equal(state().transformHistory.at(-1).codexEditId, editId);

  // Invalid final operations must never leave earlier operations applied.
  const beforeInvalid = captureCodexProject();
  assert.throws(() => state().applyCodexPlan({ message: '', operations: [
    { type: 'add_frames', afterFrameNumber: 1, copyFromFrameNumber: 1, count: 1 },
    framePatch('nonexistent', [1], { rotation: 30 }),
  ] }, beforeInvalid));
  assert.deepEqual(captureCodexProject(), beforeInvalid);
  assert.throws(() => applyEditPlan(beforeInvalid, { message: '', operations: [{ type: 'remove_frames', frameNumbers: [1, 2, 3] }] }, Object.keys(original.assets)));
  assert.throws(() => applyEditPlan(beforeInvalid, { message: '', operations: [framePatch('body', [1], { scaleX: 0 })] }, Object.keys(original.assets)));
  assert.throws(() => applyEditPlan(beforeInvalid, { message: '', operations: [{ type: 'add_node', nodeId: '__proto__', name: 'Bad', parentId: null, spriteIds: [] }] }, Object.keys(original.assets)));
  const locked = structuredClone(beforeInvalid);
  locked.nodes.body.locked = true;
  assert.throws(() => applyEditPlan(locked, { message: '', operations: [framePatch('body', [1], { rotation: 15 })] }, Object.keys(original.assets)));

  // A new edit invalidates a pending plan. Undo must retain later manual changes for redo.
  state().renameNode('body', 'Manual name');
  assert.throws(() => state().applyCodexPlan(plan, changed));
  state().undoTransform(); // checkpoint of the manual edit
  assert.equal(state().nodes.body.name, changed.nodes.body.name);
  state().undoTransform(); // full AI transaction
  assert.deepEqual(captureCodexProject(), original);
  state().redoTransform();
  state().redoTransform();
  assert.equal(state().nodes.body.name, 'Manual name');

  const pivotScene = captureCodexProject();
  const moved = applyEditPlan(pivotScene, { message: '', operations: [{ type: 'set_node', nodeId: 'body', name: null, pivotX: pivotScene.nodes.body.pivot.x + 3, pivotY: null, visible: null, locked: null }] }, Object.keys(original.assets));
  assert.equal(moved.frames[0].nodeStates.body.position.x, pivotScene.frames[0].nodeStates.body.position.x + 3);
  assert.equal(moved.frames[0].nodeStates.head.position.x, pivotScene.frames[0].nodeStates.head.position.x - 3);
  const bodySubtree = new Set();
  const collectSubtree = (id) => { bodySubtree.add(id); (pivotScene.nodes[id]?.children ?? []).forEach(collectSubtree); };
  collectSubtree('body');
  const removed = applyEditPlan(pivotScene, { message: '', operations: [{ type: 'remove_node', nodeId: 'body' }] }, Object.keys(original.assets));
  for (const id of bodySubtree) assert.equal(removed.nodes[id], undefined);
  assert.equal(Object.keys(removed.nodes).length, Object.keys(pivotScene.nodes).length - bodySubtree.size);
  assert.ok(!removed.rootNodeIds.includes('body'));
  const prompt = codexPrompt('edit animation', [], captureCodexProject());
  assert.ok(!prompt.includes('data:image'));
  assert.ok(prompt.includes('currentFrameNumber'));
  console.log('PASS: atomic AI edit, nodes/frames/groups/settings undo + redo, invalid and locked operations, stale plans, manual edit retention, pivots, subtree deletion, image-free context.');
} finally {
  await server.close();
}
