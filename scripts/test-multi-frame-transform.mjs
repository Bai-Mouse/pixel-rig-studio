import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = () => useProjectStore.getState();
  const selected = [0, 2, 4];
  function setup() {
    state().createCharacterTemplateProject();
    const initial = state().frames[0];
    const frames = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(initial), id: `test-frame-${i}`, nodeStates: {
      ...structuredClone(initial.nodeStates), body: { ...structuredClone(initial.nodeStates.body), position: { x: i * 10, y: -i * 5 }, rotation: i * 15,
        scale: { x: i % 2 ? 1 : -1 - i, y: i + 1 }, imageIndex: 0, visible: i !== 2, sortingOrder: i },
    } }));
    useProjectStore.setState({ frames, currentFrameIndex: 4, selectedFrameIds: selected.map(i => frames[i].id), transformHistory: [], redoStack: [] });
    return structuredClone(frames);
  }
  let before = setup();
  state().beginTransform('body');
  state().updateNodeFrame('body', { position: { x: 45, y: -10 } });
  state().updateNodeFrame('body', { position: { x: 47, y: -8 } });
  state().updateNodeFrame('body', { rotation: 80 });
  state().updateNodeFrame('body', { scale: { x: -10, y: 10 } });
  state().commitTransform();
  for (let i = 0; i < 5; i++) {
    const actual = state().frames[i].nodeStates.body;
    if (!selected.includes(i)) { assert.deepEqual(state().frames[i], before[i]); continue; }
    assert.deepEqual(actual.position, { x: before[i].nodeStates.body.position.x + 7, y: before[i].nodeStates.body.position.y + 12 });
    assert.equal(actual.rotation, before[i].nodeStates.body.rotation + 20);
    assert.equal(actual.scale.x, before[i].nodeStates.body.scale.x * 2);
    assert.equal(actual.scale.y, before[i].nodeStates.body.scale.y * 2);
    assert.equal(actual.sortingOrder, before[i].nodeStates.body.sortingOrder);
    assert.deepEqual(state().frames[i].nodeStates.head, before[i].nodeStates.head);
  }
  assert.equal(state().transformHistory.length, 1);
  const after = structuredClone(state().frames);
  state().undoTransform(); assert.deepEqual(state().frames, before);
  state().redoTransform(); assert.deepEqual(state().frames, after);
  before = setup();
  state().flipNode('body', 'horizontal');
  assert.equal(state().transformHistory.length, 1);
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.scale.x, -before[i].nodeStates.body.scale.x));
  [1, 3].forEach(i => assert.deepEqual(state().frames[i], before[i]));
  state().undoTransform(); assert.deepEqual(state().frames, before);
  state().flipNode('body', 'vertical');
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.scale.y, -before[i].nodeStates.body.scale.y));
  state().undoTransform();
  state().resetNodeTransform('body');
  selected.forEach(i => {
    const pose = state().frames[i].nodeStates.body;
    assert.deepEqual(pose.position, state().nodes.body.transform.position);
    assert.equal(pose.rotation, state().nodes.body.transform.rotation);
    assert.deepEqual(pose.scale, state().nodes.body.transform.scale);
    assert.equal(pose.visible, before[i].nodeStates.body.visible);
    assert.equal(pose.sortingOrder, before[i].nodeStates.body.sortingOrder);
  });
  state().undoTransform(); assert.deepEqual(state().frames, before);
  state().setNodeSortingOrder('body', 20);
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.sortingOrder, 20));
  state().undoTransform(); assert.deepEqual(state().frames, before);
  state().beginInspectorEdit('body'); state().updateInspectorFrame('body', { position: { x: 99 }, visible: true }); state().commitInspectorEdit();
  selected.forEach(i => { assert.equal(state().frames[i].nodeStates.body.position.x, 99); assert.equal(state().frames[i].nodeStates.body.position.y, before[i].nodeStates.body.position.y); assert.equal(state().frames[i].nodeStates.body.visible, true); });
  state().undoTransform(); assert.deepEqual(state().frames, before);
  // Look up a guaranteed imported asset instead of relying on sample asset IDs.
  const another = Object.keys(state().assets).find(id => !state().nodes.body.assetIds.includes(id));
  assert(another); state().addNodeSprites('body', [another]);
  const index = state().nodes.body.assetIds.indexOf(another);
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.imageIndex, index));
  [1, 3].forEach(i => assert.equal(state().frames[i].nodeStates.body.imageIndex, before[i].nodeStates.body.imageIndex));
  state().setNodeFrameSprite('body', 0); selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.imageIndex, 0));
  before = setup();
  state().setRotationSnapAngle(15); state().beginTransform('body'); state().updateNodeFrame('body', { rotation: 83 }); state().commitTransform();
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.rotation, before[i].nodeStates.body.rotation + 30));
  state().undoTransform(); assert.deepEqual(state().frames, before);
  state().beginTransform('body'); state().updateNodeFrame('body', { position: { x: 49 } });
  state().selectFrame(1); assert.equal(state().transformSession, null); assert.equal(state().transformHistory.length, 1);
  state().undoTransform(); assert.deepEqual(state().frames, before);
  setup();
  useProjectStore.setState({ nodes: { ...state().nodes, body: { ...state().nodes.body, transform: { ...state().nodes.body.transform, rotation: 12 } } } });
  state().setRotationSnapAngle(15); state().resetNodeTransform('body');
  selected.forEach(i => assert.equal(state().frames[i].nodeStates.body.rotation, 12));
  before = setup();
  const missing = structuredClone(before); delete missing[2].nodeStates.body;
  useProjectStore.setState({ frames: missing });
  state().beginTransform('body'); state().updateNodeFrame('body', { position: { x: 41 } }); state().commitTransform();
  assert(state().frames[2].nodeStates.body); state().undoTransform(); assert(!state().frames[2].nodeStates.body);
  setup(); state().toggleNodeLock('body'); before = structuredClone(state().frames);
  state().beginTransform('body'); state().updateNodeFrame('body', { rotation: 99 }); state().commitTransform();
  state().flipNode('body', 'horizontal'); state().resetNodeTransform('body'); state().setNodeSortingOrder('body', 999);
  assert.deepEqual(state().frames, before); assert.equal(state().transformHistory.length, 0);
  before = setup(); state().selectFrame(1); state().beginTransform('body'); state().updateNodeFrame('body', { position: { x: 15 } }); state().commitTransform();
  assert.equal(state().frames[1].nodeStates.body.position.x, 15);
  [0, 2, 3, 4].forEach(i => assert.deepEqual(state().frames[i], before[i]));
  state().undoTransform(); assert.deepEqual(state().frames, before);
  console.log('PASS: relative selected-frame gestures without accumulation, flips/reset, inspector absolute edits, sprites/layers, snapping, missing states, locks, single-frame behavior, atomic undo/redo.');
} finally { await server.close(); }
