import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = () => useProjectStore.getState();

  state().createCharacterTemplateProject();
  const baseFrame = state().frames[0];

  /** Five frames whose body x encodes their index; optional group/drawing layer on index 1. */
  function seedFrames(selectedIndexes = [2], currentFrameIndex = 2, isPlaying = false) {
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
      isPlaying,
      playbackGroupId: null,
      transformSession: null,
      inspectorSession: null,
    });
    return frames;
  }

  const ids = () => state().frames.map((frame) => frame.id);
  const bodyX = () => state().frames.map((frame) => frame.nodeStates.body.position.x);

  // 1. Deleting a multi-selection removes every selected frame (when the current frame is part of it).
  seedFrames([1, 2, 3], 2, true);
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-0', 'frame-4']);
  assert.deepEqual(bodyX(), [100, 104]);
  assert.equal(state().currentFrameIndex, 1, 'the current index lands on the frame after the removed block');
  assert.equal(state().isPlaying, false, 'playback stops');
  assert.deepEqual(state().selectedFrameIds, [], 'the selection is cleared');
  assert.equal(state().frameSelectionAnchorId, null);
  assert.equal(state().frames[1].group?.id, 'group-tail', 'untouched frames keep their grouping');

  // 2. A selection that does not contain the current frame deletes only the current frame.
  seedFrames([0, 3], 2);
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-0', 'frame-1', 'frame-3', 'frame-4']);
  assert.equal(state().currentFrameIndex, 2, 'the current index stays on the next surviving frame');
  assert.equal(state().frames[2].id, 'frame-3');
  assert.equal(state().frames[1].canvasData, 'data:image/png;base64,keep-me', 'drawing layers survive');

  // 3. Non-contiguous multi-selection.
  seedFrames([0, 2, 4], 2);
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-1', 'frame-3']);
  assert.equal(state().currentFrameIndex, 1);
  assert.equal(state().frames[1].id, 'frame-3');

  // 4. A selection covering the whole timeline is refused, so the project keeps one frame.
  seedFrames([0, 1, 2, 3, 4], 2);
  state().deleteFrame();
  assert.equal(state().frames.length, 5);
  assert.deepEqual(ids(), ['frame-0', 'frame-1', 'frame-2', 'frame-3', 'frame-4']);

  // 5. A single-frame project cannot be emptied.
  state().createCharacterTemplateProject();
  assert.equal(state().frames.length, 1);
  useProjectStore.setState({ selectedFrameIds: [state().frames[0].id] });
  state().deleteFrame();
  assert.equal(state().frames.length, 1);

  // 6. Deleting the last selected frame clamps the current index to the new end.
  seedFrames([3, 4], 4);
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-0', 'frame-1', 'frame-2']);
  assert.equal(state().currentFrameIndex, 2);
  assert.equal(state().frames[2].id, 'frame-2');

  // 7. Deleting a contiguous block at the start keeps the current frame on the next survivor.
  seedFrames([0, 1], 1);
  state().deleteFrame();
  assert.deepEqual(ids(), ['frame-2', 'frame-3', 'frame-4']);
  assert.equal(state().currentFrameIndex, 0);

  console.log('Multi-frame delete checks passed.');
} finally {
  await server.close();
}
