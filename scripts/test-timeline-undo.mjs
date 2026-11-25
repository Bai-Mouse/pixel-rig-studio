import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = () => useProjectStore.getState();

  state().createCharacterTemplateProject();
  const baseFrame = state().frames[0];

  /** Five frames whose body x encodes the project frame index; the second frame carries a drawing layer. */
  function seedFrames(selectedIndexes = [2], currentFrameIndex = 2) {
    const frames = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(baseFrame),
      id: `frame-${index}`,
      nodeStates: {
        ...structuredClone(baseFrame.nodeStates),
        body: { ...structuredClone(baseFrame.nodeStates.body), position: { x: 100 + index, y: 0 } },
      },
      canvasData: index === 1 ? 'data:image/png;base64,keep-me' : undefined,
      group: index === 4 ? { id: 'group-tail', name: 'Tail', color: '#8899ff' } : undefined,
    }));
    useProjectStore.setState({
      frames,
      currentFrameIndex,
      selectedFrameIds: selectedIndexes.map((index) => `frame-${index}`),
      frameSelectionAnchorId: `frame-${selectedIndexes[0]}`,
      fps: 12,
      isLooping: true,
      isPlaying: false,
      transformHistory: [],
      redoStack: [],
    });
    return frames;
  }

  const ids = () => state().frames.map((frame) => frame.id);
  const bodyX = () => state().frames.map((frame) => frame.nodeStates.body.position.x);
  const historySize = () => state().transformHistory.length;

  // Selection preview loops even if normal playback loop is disabled.
  seedFrames([1, 3], 3);
  state().toggleLooping();
  state().toggleSelectionPlayback();
  assert.equal(state().currentFrameIndex, 1);
  state().advanceFrame();
  assert.equal(state().currentFrameIndex, 3);
  state().advanceFrame();
  assert.equal(state().currentFrameIndex, 1);
  state().toggleSelectionPlayback();
  assert.equal(state().isPlaying, false);
  assert.deepEqual(state().selectedFrameIds, ['frame-1', 'frame-3']);
  assert.equal(historySize(), 0);
  seedFrames([0], 0);
  state().groupFrames([0, 2], 'Preview group', '#aabbcc');
  state().selectFrame(2);
  state().toggleSelectionPlayback();
  assert.equal(state().currentFrameIndex, 0);
  state().advanceFrame();
  assert.equal(state().currentFrameIndex, 2);
  state().advanceFrame();
  assert.equal(state().currentFrameIndex, 0);
  state().selectFrame(1);
  assert.equal(state().isPlaying, false);

  const animation = (count, fps = 24, loop = false) => ({
    format: 'pixel-rig-animation',
    version: 3,
    fps,
    loop,
    canvasSize: { x: 320, y: 240 },
    nodes: {},
    frames: Array.from({ length: count }, (_, index) => ({
      id: `anim-frame-${index}`,
      nodeStates: {
        body: { position: { x: index * 10, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1 },
      },
    })),
  });

  // 1. Insert: one undo step restores the previous frames, playhead and selection.
  seedFrames([1, 2], 2);
  const beforeInsert = state().frames;
  state().insertFrame();
  assert.equal(state().frames.length, 6);
  assert.equal(historySize(), 1, 'inserting a frame records one undo step');
  assert.equal(state().transformHistory.at(-1).label, 'Insert frame');
  state().undoTransform();
  assert.deepEqual(state().frames, beforeInsert);
  assert.equal(state().currentFrameIndex, 2);
  assert.deepEqual(state().selectedFrameIds, ['frame-1', 'frame-2']);
  state().redoTransform();
  assert.equal(state().frames.length, 6, 'redo inserts the frame again');

  // 2. Duplicate keeps the cloned pose and undoes as one step.
  seedFrames([2], 2);
  state().duplicateFrame();
  assert.equal(bodyX()[3], 102);
  assert.equal(historySize(), 1);
  state().undoTransform();
  assert.equal(state().frames.length, 5);
  assert.equal(state().currentFrameIndex, 2);

  // Non-adjacent frames copy in timeline order, with the drawing and group intact.
  const beforeBatchCopy = seedFrames([4, 1], 1);
  state().duplicateFrame();
  const copies = state().frames.slice(5);
  assert.deepEqual(bodyX(), [100, 101, 102, 103, 104, 101, 104]);
  assert.equal(new Set(ids()).size, 7);
  assert.equal(copies[0].canvasData, beforeBatchCopy[1].canvasData);
  assert.deepEqual(copies[1].group, beforeBatchCopy[4].group);
  assert.notEqual(copies[0].nodeStates.body.position, beforeBatchCopy[1].nodeStates.body.position);
  assert.deepEqual(state().selectedFrameIds, copies.map((frame) => frame.id));
  assert.equal(state().currentFrameIndex, 5);
  assert.equal(historySize(), 1);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeBatchCopy);
  assert.deepEqual(state().selectedFrameIds, ['frame-4', 'frame-1']);
  state().redoTransform();
  assert.deepEqual(state().frames.slice(5), copies);

  // 3. Multi-frame delete restores every removed frame, including its drawing layer.
  seedFrames([1, 2, 3], 2);
  const beforeDelete = state().frames;
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-0', 'frame-4']);
  assert.equal(state().transformHistory.at(-1).label, 'Delete 3 frames');
  state().undoTransform();
  assert.deepEqual(state().frames, beforeDelete);
  assert.equal(state().frames[1].canvasData, 'data:image/png;base64,keep-me', 'the drawing layer comes back');
  assert.equal(state().currentFrameIndex, 2);
  state().redoTransform();
  assert.deepEqual(ids(), ['frame-0', 'frame-4'], 'redo deletes the same block again');

  // 4. Moving a frame is undoable and keeps the same frame objects.
  seedFrames([0], 0);
  const beforeMove = state().frames;
  state().moveFrame(0, 3);
  assert.deepEqual(ids(), ['frame-1', 'frame-2', 'frame-3', 'frame-0', 'frame-4']);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeMove);
  assert.equal(state().currentFrameIndex, 0, 'the playhead returns to where it was');

  seedFrames([0, 2], 2);
  const beforeBatchMove = state().frames;
  assert.equal(state().moveFrames(['frame-2', 'frame-0'], 5), true);
  assert.deepEqual(ids(), ['frame-1', 'frame-3', 'frame-4', 'frame-0', 'frame-2']);
  assert.equal(state().frames[4], beforeBatchMove[2]);
  assert.deepEqual(state().selectedFrameIds, ['frame-0', 'frame-2']);
  assert.equal(state().currentFrameIndex, 4);
  assert.equal(historySize(), 1);
  assert.equal(state().moveFrames(state().selectedFrameIds, 5), false);
  assert.equal(historySize(), 1);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeBatchMove);
  assert.equal(state().currentFrameIndex, 2);
  state().redoTransform();
  assert.equal(state().currentFrameIndex, 4);
  assert.equal(state().moveFrames(state().selectedFrameIds, 0), true);
  assert.deepEqual(ids(), ['frame-0', 'frame-2', 'frame-1', 'frame-3', 'frame-4']);
  assert.equal(state().moveFrames(['frame-0', 'stale-frame'], 3), false);

  // 5. In-between frames undo as a single step.
  seedFrames([0], 0);
  state().insertTweenFrames(0, 2, 3, { position: true, rotation: true, scale: true, visible: false, sprite: false });
  assert.equal(state().frames.length, 8);
  assert.equal(historySize(), 1);
  state().undoTransform();
  assert.deepEqual(ids(), ['frame-0', 'frame-1', 'frame-2', 'frame-3', 'frame-4']);
  assert.equal(state().currentFrameIndex, 0, 'the playhead returns to the frame it was on before');

  // 6. Grouping, renaming and ungrouping are undoable.
  seedFrames([2], 2);
  state().groupFrames([0, 1, 2], 'Run', '#55aaff');
  assert.equal(state().frames[0].group?.name, 'Run');
  assert.equal(historySize(), 1);
  const groupedId = state().frames[0].group.id;
  state().undoTransform();
  assert.equal(state().frames[0].group, undefined, 'ungrouped again');
  state().redoTransform();
  assert.equal(state().frames[0].group?.id, groupedId);
  state().renameFrameGroup(groupedId, 'Dash', '#ff8844');
  assert.equal(state().frames[0].group.name, 'Dash');
  state().undoTransform();
  assert.equal(state().frames[0].group.name, 'Run');
  state().ungroupFrames(groupedId);
  assert.equal(state().frames[0].group, undefined);
  state().undoTransform();
  assert.equal(state().frames[0].group?.name, 'Run', 'ungroup is undoable too');

  // 7. Animation template insertion is undoable.
  seedFrames([2], 2);
  const beforeTemplate = state().frames;
  state().applyAnimationTemplate('walk');
  assert.equal(state().frames.length, 11);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeTemplate);

  // 8. Importing an animation is undoable, including the FPS/loop it replaced.
  seedFrames([2], 2);
  assert.equal(state().loadAnimation(animation(4, 20, false)), true);
  assert.equal(state().frames.length, 4);
  assert.equal(state().fps, 20);
  assert.equal(historySize(), 1);
  assert.equal(state().transformHistory.at(-1).label, 'Replace timeline with imported animation');
  state().undoTransform();
  assert.deepEqual(ids(), ['frame-0', 'frame-1', 'frame-2', 'frame-3', 'frame-4']);
  assert.deepEqual(bodyX(), [100, 101, 102, 103, 104]);
  assert.equal(state().fps, 12, 'the previous FPS returns');
  assert.equal(state().isLooping, true, 'the previous loop flag returns');
  state().redoTransform();
  assert.equal(state().frames.length, 4);
  assert.equal(state().fps, 20);

  // 9. Insert/overwrite/delta imports are undoable as well.
  seedFrames([2], 2);
  const beforeImportInsert = state().frames;
  state().loadAnimation(animation(2), { mode: 'insert', startIndex: 1 });
  assert.equal(state().frames.length, 7);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeImportInsert);

  seedFrames([2], 2);
  const beforeImportOverwrite = state().frames;
  state().loadAnimation(animation(2), { mode: 'overwrite', startIndex: 1 });
  assert.equal(state().frames[1].nodeStates.body.position.x, 0);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeImportOverwrite);

  seedFrames([2], 2);
  const beforeImportDelta = state().frames;
  state().loadAnimation(animation(2), { mode: 'delta', startIndex: 1 });
  assert.notDeepEqual(bodyX(), [100, 101, 102, 103, 104]);
  state().undoTransform();
  assert.deepEqual(state().frames, beforeImportDelta);

  // 10. A new timeline edit after an undo clears the redo stack.
  seedFrames([2], 2);
  state().insertFrame();
  state().undoTransform();
  assert.equal(state().redoStack.length, 1);
  state().duplicateFrame();
  assert.equal(state().redoStack.length, 0, 'a fresh frame edit drops the redo stack');

  // 11. Timeline edits and pose edits share one ordered history.
  seedFrames([2], 2);
  state().beginTransform('body');
  state().updateNodeFrame('body', { position: { x: 140 } });
  state().commitTransform();
  state().deleteFrame();
  assert.equal(historySize(), 2);
  state().undoTransform();
  assert.equal(state().frames.length, 5, 'the first Ctrl+Z brings the deleted frame back');
  state().undoTransform();
  assert.equal(state().frames[2].nodeStates.body.position.x, 102, 'the second Ctrl+Z undoes the pose edit');

  // 12. The timeline history is capped so long sessions cannot grow without bound.
  seedFrames([2], 2);
  for (let index = 0; index < 120; index += 1) state().insertFrame();
  assert.equal(state().transformHistory.length, 80, 'history keeps the newest 80 steps');

  console.log('PASS: insert/duplicate/delete/move/in-between/grouping/template/import frame edits undo and redo as single timeline steps, ordered with pose edits.');
} finally { await server.close(); }
