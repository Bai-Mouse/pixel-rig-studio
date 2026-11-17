import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { selectFrameEntries, selectFramesForExport } = await server.ssrLoadModule('/src/export/animationRenderer.ts');

  const group = { id: 'group-run', name: 'Run', color: '#7887f2' };
  const frames = Array.from({ length: 6 }, (_, index) => ({
    id: `frame-${index}`,
    nodeStates: {},
    group: index >= 1 && index <= 3 ? { ...group } : undefined,
  }));

  const indexes = (entries) => entries.map((entry) => entry.index);

  // 1. All frames, including their timeline positions.
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'all' })), [0, 1, 2, 3, 4, 5]);
  assert.equal(selectFrameEntries(frames, { mode: 'all' })[4].frame.id, 'frame-4');

  // 2. The current frame only.
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'current', currentIndex: 2 })), [2]);
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'current', currentIndex: 0 })), [0]);
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'current', currentIndex: 99 })), [5], 'an out-of-range playhead clamps to the last frame');
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'current', currentIndex: -3 })), [0], 'a negative playhead clamps to the first frame');

  // 3. One frame group.
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'group', frameGroupId: 'group-run' })), [1, 2, 3]);
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'group', frameGroupId: 'missing-group' })), [0, 1, 2, 3, 4, 5], 'an unknown group falls back to every frame');

  // 4. A custom range, 1-based and inclusive in the UI.
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'range', start: 2, end: 4 })), [1, 2, 3]);
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'range', start: 4, end: 2 })), [1, 2, 3], 'a reversed range is normalised');
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'range', start: 0, end: 99 })), [0, 1, 2, 3, 4, 5], 'out-of-range edges clamp to the timeline');
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'range', start: 3, end: 3 })), [2], 'a single-frame range exports one frame');
  assert.deepEqual(indexes(selectFrameEntries(frames, { mode: 'range', start: 2.4, end: 5.6 })), [1, 2, 3, 4, 5], 'fractional values round');

  // 5. No frames means no export.
  assert.deepEqual(selectFrameEntries([], { mode: 'all' }), []);
  assert.deepEqual(selectFrameEntries([], { mode: 'current', currentIndex: 0 }), []);

  // 6. The plain group helper still matches its old behaviour.
  assert.equal(selectFramesForExport(frames, null).length, 6);
  assert.deepEqual(selectFramesForExport(frames, 'group-run').map((frame) => frame.id), ['frame-1', 'frame-2', 'frame-3']);

  console.log('PASS: export frame selection supports all frames, the current frame, a frame group and a clamped 1-based range.');
} finally { await server.close(); }
