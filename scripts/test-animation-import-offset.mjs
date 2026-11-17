import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = () => useProjectStore.getState();

  state().createCharacterTemplateProject();
  const baseFrame = state().frames[0];

  const importedFrame = (index) => ({
    id: `anim-frame-${index}`,
    nodeStates: {
      body: {
        position: { x: index * 10, y: -index },
        rotation: index * 5,
        scale: { x: 1, y: 1 },
        visible: true,
        imageIndex: 0,
        sortingOrder: 1,
      },
    },
  });

  const animation = (count, fps = 24, loop = false) => ({
    format: 'pixel-rig-animation',
    version: 3,
    fps,
    loop,
    canvasSize: { x: 320, y: 240 },
    nodes: {},
    frames: Array.from({ length: count }, (_, index) => importedFrame(index)),
  });

  /** Seeds a timeline whose body x encodes the project frame index (100 + i). */
  function seedFrames(count, currentFrameIndex = 0) {
    const frames = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(baseFrame),
      id: `project-frame-${index}`,
      nodeStates: {
        ...structuredClone(baseFrame.nodeStates),
        body: { ...structuredClone(baseFrame.nodeStates.body), position: { x: 100 + index, y: 0 } },
      },
      group: index === 2 ? { id: 'group-loop', name: 'Loop', color: '#7887f2' } : undefined,
    }));
    useProjectStore.setState({
      frames,
      currentFrameIndex,
      selectedFrameIds: [frames[currentFrameIndex].id],
      fps: 12,
      isLooping: true,
      isPlaying: false,
      transformHistory: [],
      redoStack: [],
    });
    return frames;
  }

  const bodyX = (frames) => frames.map((frame) => frame.nodeStates.body.position.x);

  // 1. Legacy behavior: replace the whole timeline and take the file's fps/loop.
  seedFrames(3);
  assert.equal(state().loadAnimation(animation(4, 20, false)), true);
  assert.equal(state().frames.length, 4);
  assert.equal(state().currentFrameIndex, 0);
  assert.equal(state().fps, 20);
  assert.equal(state().isLooping, false);
  assert.deepEqual(bodyX(state().frames), [0, 10, 20, 30]);
  assert.notEqual(state().frames[0].id, 'anim-frame-0', 'imported frames get fresh ids');
  assert.deepEqual(state().selectedFrameIds, []);

  // 2. Insert at the selected frame: existing frames and project fps/loop survive.
  seedFrames(3, 2);
  assert.equal(state().loadAnimation(animation(3, 20, false), { mode: 'insert', startIndex: 1 }), true);
  assert.equal(state().frames.length, 6);
  assert.equal(state().currentFrameIndex, 1);
  assert.equal(state().fps, 12, 'insert keeps the project fps');
  assert.equal(state().isLooping, true, 'insert keeps the project loop flag');
  assert.deepEqual(bodyX(state().frames), [100, 0, 10, 20, 101, 102]);
  assert.equal(state().frames[0].id, 'project-frame-0');
  assert.equal(state().frames[4].id, 'project-frame-1');
  assert.equal(state().frames[5].id, 'project-frame-2');
  assert.deepEqual(state().selectedFrameIds, []);

  // 3. Insert defaults to the current frame when no start index is given.
  seedFrames(2, 1);
  assert.equal(state().loadAnimation(animation(2), { mode: 'insert' }), true);
  assert.equal(state().frames.length, 4);
  assert.equal(state().currentFrameIndex, 1);
  assert.deepEqual(bodyX(state().frames), [100, 0, 10, 101]);

  // 4. Overwrite from the selected frame: original ids/groups survive, later frames stay.
  seedFrames(5, 2);
  assert.equal(state().loadAnimation(animation(2), { mode: 'overwrite', startIndex: 1 }), true);
  assert.equal(state().frames.length, 5, 'a short animation does not truncate the timeline');
  assert.equal(state().currentFrameIndex, 1);
  assert.equal(state().fps, 12);
  assert.equal(state().isLooping, true);
  assert.deepEqual(bodyX(state().frames), [100, 0, 10, 103, 104]);
  assert.equal(state().frames[1].id, 'project-frame-1', 'overwritten frames keep their identity');
  assert.equal(state().frames[2].group?.id, 'group-loop', 'frame grouping is preserved');
  assert.equal(state().frames[3].id, 'project-frame-3');

  // 5. Overwrite past the end extends the timeline.
  seedFrames(2, 0);
  assert.equal(state().loadAnimation(animation(4), { mode: 'overwrite', startIndex: 1 }), true);
  assert.equal(state().frames.length, 5);
  assert.deepEqual(bodyX(state().frames), [100, 0, 10, 20, 30]);
  assert.equal(state().currentFrameIndex, 1);

  // 6. Offsets outside the timeline are clamped instead of creating holes.
  seedFrames(2, 0);
  assert.equal(state().loadAnimation(animation(1), { mode: 'insert', startIndex: 99 }), true);
  assert.equal(state().frames.length, 3);
  assert.equal(state().currentFrameIndex, 2);
  assert.deepEqual(bodyX(state().frames), [100, 101, 0]);

  // 7. Delta mode: add each imported frame's pose change to the previous result.
  const motionState = (body, headImageIndex = 1) => ({
    body: {
      position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 1, ...body,
    },
    head: {
      position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: headImageIndex, sortingOrder: 0,
    },
  });
  const motionAnimation = (states, fps = 30, loop = true) => ({
    format: 'pixel-rig-animation',
    version: 3,
    fps,
    loop,
    canvasSize: { x: 320, y: 240 },
    nodes: {},
    frames: states.map((state, index) => ({ id: `motion-frame-${index}`, nodeStates: structuredClone(state) })),
  });

  seedFrames(3, 1);
  const baseState = structuredClone(state().frames[1].nodeStates.body);
  const baseHead = structuredClone(state().frames[1].nodeStates.head);
  const seeded = [...state().frames];
  seeded[1] = { ...seeded[1], canvasData: 'data:image/png;base64,drawing-layer', group: { id: 'group-delta', name: 'Delta', color: '#ff8800' } };
  useProjectStore.setState({ frames: seeded });

  const motion = motionAnimation([
    motionState({ position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, sortingOrder: 1 }, 1),
    motionState({ position: { x: 10, y: -2 }, rotation: 5, scale: { x: 2, y: 2 }, visible: false, sortingOrder: 3 }, 3),
    motionState({ position: { x: 30, y: -6 }, rotation: 15, scale: { x: 4, y: 4 }, visible: true, sortingOrder: 1 }, 2),
    motionState({ position: { x: 60, y: -12 }, rotation: 30, scale: { x: 4, y: 4 }, visible: true, sortingOrder: 2 }, 2),
  ]);
  assert.equal(state().loadAnimation(motion, { mode: 'delta', startIndex: 1 }), true);
  assert.equal(state().frames.length, 5, 'delta mode extends the timeline when the animation is longer');
  assert.equal(state().currentFrameIndex, 1);
  assert.equal(state().fps, 12, 'delta mode keeps the project fps');
  assert.equal(state().isLooping, true, 'delta mode keeps the project loop flag');
  assert.equal(bodyX(state().frames)[0], 100, 'frames before the offset are untouched');

  const bodyAt = (index) => state().frames[index].nodeStates.body;
  const headAt = (index) => state().frames[index].nodeStates.head;
  // The first imported frame is the origin: it must leave the selected pose alone.
  assert.deepEqual(bodyAt(1), baseState);
  assert.deepEqual(headAt(1), baseHead);
  assert.equal(state().frames[1].id, 'project-frame-1', 'the selected frame keeps its identity');
  assert.equal(state().frames[1].group?.id, 'group-delta', 'the selected frame keeps its group');
  assert.equal(state().frames[1].canvasData, 'data:image/png;base64,drawing-layer', 'the drawing layer survives');
  // Accumulated offsets: +10/-2, +20/-4, +30/-6.
  assert.deepEqual(bodyAt(2).position, { x: baseState.position.x + 10, y: baseState.position.y - 2 });
  assert.deepEqual(bodyAt(3).position, { x: baseState.position.x + 30, y: baseState.position.y - 6 });
  assert.deepEqual(bodyAt(4).position, { x: baseState.position.x + 60, y: baseState.position.y - 12 });
  // Accumulated angles: +5, +15, +30.
  assert.equal(bodyAt(2).rotation, baseState.rotation + 5);
  assert.equal(bodyAt(3).rotation, baseState.rotation + 15);
  assert.equal(bodyAt(4).rotation, baseState.rotation + 30);
  // Scale changes apply as ratios: 1 -> 2 -> 4 -> 4.
  assert.equal(bodyAt(2).scale.x, baseState.scale.x * 2);
  assert.equal(bodyAt(3).scale.x, baseState.scale.x * 4);
  assert.equal(bodyAt(4).scale.x, baseState.scale.x * 4);
  // Discrete values follow the animation only when it changes them.
  assert.equal(bodyAt(2).visible, false);
  assert.equal(bodyAt(3).visible, true);
  assert.equal(bodyAt(2).sortingOrder, baseState.sortingOrder + 2);
  assert.equal(bodyAt(3).sortingOrder, baseState.sortingOrder);
  assert.equal(bodyAt(4).sortingOrder, baseState.sortingOrder + 1);
  // Sprite changes accumulate and clamp to the node's sprite count.
  assert.equal(headAt(2).imageIndex, Math.min(3, baseHead.imageIndex + 2));
  assert.equal(headAt(3).imageIndex, Math.min(3, baseHead.imageIndex + 1));
  assert.equal(headAt(4).imageIndex, Math.min(3, baseHead.imageIndex + 1));
  // Appended frames are fresh frames without the original grouping.
  assert.notEqual(state().frames[3].id, 'project-frame-3');
  assert.equal(state().frames[3].group, undefined);

  // 8. A one-frame animation has no deltas and leaves the selected pose untouched.
  seedFrames(2, 1);
  const untouched = structuredClone(state().frames[1]);
  assert.equal(state().loadAnimation(motionAnimation([motionState({ position: { x: 99, y: 99 } })]), { mode: 'delta', startIndex: 1 }), true);
  assert.deepEqual(state().frames[1].nodeStates, untouched.nodeStates);

  // 9. Animations with no node shared with the project are rejected in every mode.
  for (const mode of ['replace', 'insert', 'overwrite', 'delta']) {
    seedFrames(2, 0);
    const before = state().frames;
    const foreign = {
      ...animation(1),
      frames: [{ id: 'x', nodeStates: { 'unknown-node': { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, visible: true, imageIndex: 0, sortingOrder: 0 } } }],
    };
    assert.equal(state().loadAnimation(foreign, mode === 'replace' ? undefined : { mode }), false);
    assert.equal(state().frames, before, `${mode} leaves the timeline untouched on mismatch`);
  }

  console.log('Animation import offset checks passed.');
} finally {
  await server.close();
}
