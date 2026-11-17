import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = () => useProjectStore.getState();

  state().createCharacterTemplateProject();
  const baseFrame = state().frames[0];

  /** Five frames; frame 4 starts inside the "Tail" group so frames can be moved in and out of it. */
  function seedFrames() {
    const frames = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(baseFrame),
      id: `frame-${index}`,
      group: index === 4 ? { id: 'group-tail', name: 'Tail', color: '#8899ff' } : undefined,
    }));
    useProjectStore.setState({
      frames,
      currentFrameIndex: 0,
      selectedFrameIds: ['frame-0'],
      frameSelectionAnchorId: 'frame-0',
      isPlaying: false,
      transformHistory: [],
      redoStack: [],
    });
    return frames;
  }

  const groupIds = () => state().frames.map((frame) => frame.group?.id ?? null);
  const groupNames = () => state().frames.map((frame) => frame.group?.name ?? null);

  // 1. Creating a group stamps a new group onto exactly the chosen frames.
  seedFrames();
  state().groupFrames([0, 1], 'Run', '#55aaff');
  const created = state().frames[0].group;
  assert.equal(created.name, 'Run');
  assert.equal(created.color, '#55aaff');
  assert.deepEqual(groupIds(), [created.id, created.id, null, null, 'group-tail']);
  assert.equal(state().transformHistory.length, 1);

  // 2. Adding frames to an existing group keeps that group's id, name and color.
  seedFrames();
  state().addFramesToGroup([0, 1, 2], 'group-tail');
  assert.deepEqual(groupIds(), ['group-tail', 'group-tail', 'group-tail', null, 'group-tail']);
  assert.deepEqual(groupNames(), ['Tail', 'Tail', 'Tail', null, 'Tail']);
  assert.equal(state().frames[2].group.color, '#8899ff');
  assert.equal(state().transformHistory.at(-1).label, 'Add 3 frames to “Tail”');

  // 3. Frames that already belong to another group move to the target group.
  seedFrames();
  state().groupFrames([0, 1], 'Run', '#55aaff');
  const runId = state().frames[0].group.id;
  state().addFramesToGroup([0, 1], 'group-tail');
  assert.deepEqual(groupIds(), ['group-tail', 'group-tail', null, null, 'group-tail']);
  assert.equal(state().frames[0].group.id, 'group-tail', 'the old group is replaced, not duplicated');
  assert.equal(state().frames.some((frame) => frame.group?.id === runId), false, 'the old group disappears with its last member');

  // 4. An unknown group id does nothing and records no history.
  seedFrames();
  state().addFramesToGroup([0, 1], 'group-missing');
  assert.deepEqual(groupIds(), [null, null, null, null, 'group-tail']);
  assert.equal(state().transformHistory.length, 0);

  // 5. Removing frames from a group only touches the given frames.
  seedFrames();
  state().addFramesToGroup([0, 1, 2], 'group-tail');
  state().removeFramesFromGroup([1]);
  assert.deepEqual(groupIds(), ['group-tail', null, 'group-tail', null, 'group-tail']);
  assert.equal(state().frames[1].group, undefined);
  assert.equal(state().transformHistory.at(-1).label, 'Remove 1 frame from group');

  // 6. Removing every member leaves no group behind.
  seedFrames();
  state().addFramesToGroup([0, 1], 'group-tail');
  state().removeFramesFromGroup([0, 1, 4]);
  assert.deepEqual(groupIds(), [null, null, null, null, null]);
  assert.deepEqual(groupNames(), [null, null, null, null, null]);

  // 7. Removing frames that have no group is a no-op.
  seedFrames();
  state().removeFramesFromGroup([0, 1, 2]);
  assert.deepEqual(groupIds(), [null, null, null, null, 'group-tail']);
  assert.equal(state().transformHistory.length, 0);

  // 8. Adding and removing are undoable and redoable as single steps.
  seedFrames();
  const before = state().frames;
  state().addFramesToGroup([0, 1, 2], 'group-tail');
  state().undoTransform();
  assert.deepEqual(state().frames, before, 'adding to a group undoes back to no group on those frames');
  state().redoTransform();
  assert.deepEqual(groupIds(), ['group-tail', 'group-tail', 'group-tail', null, 'group-tail']);

  const afterAdd = state().frames;
  state().removeFramesFromGroup([0, 2]);
  state().undoTransform();
  assert.deepEqual(state().frames, afterAdd, 'removing frames from a group restores them');
  state().redoTransform();
  assert.deepEqual(groupIds(), [null, 'group-tail', null, null, 'group-tail']);

  // 9. Whole-group ungrouping still works and is undoable.
  seedFrames();
  state().addFramesToGroup([0, 2], 'group-tail');
  const grouped = state().frames;
  state().ungroupFrames('group-tail');
  assert.deepEqual(groupIds(), [null, null, null, null, null]);
  state().undoTransform();
  assert.deepEqual(state().frames, grouped);

  console.log('PASS: frames can join an existing group, move between groups, and be removed from a group one by one, all undoable.');
} finally { await server.close(); }
