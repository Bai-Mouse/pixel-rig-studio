import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { rotationDragDelta } = await server.ssrLoadModule('/src/canvas/rotationDrag.ts');
  const matrix = (angle, sx, sy, e = 40, f = 50) => {
    const r = angle * Math.PI / 180;
    return { a: Math.cos(r) * sx, b: Math.sin(r) * sx, c: -Math.sin(r) * sy, d: Math.cos(r) * sy, e, f };
  };
  const rotate = (point, angle) => { const r = angle * Math.PI / 180; return { x: point.x * Math.cos(r) - point.y * Math.sin(r), y: point.x * Math.sin(r) + point.y * Math.cos(r) }; };
  const world = (parent, position, local) => ({ x: parent.a * (position.x + local.x) + parent.c * (position.y + local.y) + parent.e, y: parent.b * (position.x + local.x) + parent.d * (position.y + local.y) + parent.f });
  const position = { x: 7, y: -4 };
  for (const parentCase of [[0, 1, 1], [35, -1, 1], [-20, 1, -1], [10, -1, -1], [25, 3, .5], [45, -2, .3]]) {
    const parent = matrix(...parentCase);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      for (const desired of [30, -30]) {
        const original = rotate({ x: 8 * sx, y: -12 * sy }, 15);
        const start = world(parent, position, original), current = world(parent, position, rotate(original, desired));
        const actual = rotationDragDelta(parent, position, start, current);
        assert(Math.abs(actual - desired) < 1e-8, `parent=${parentCase}, self flip=${sx},${sy}: pointer moved ${desired}°, node rotated ${actual}°`);
      }
    }
  }
  const identity = matrix(0, 1, 1, 0, 0), zero = { x: 0, y: 0 };
  const at = angle => rotate({ x: 10, y: 0 }, angle);
  assert(Math.abs(rotationDragDelta(identity, zero, at(179), at(-179)) - 2) < 1e-8);
  assert(Math.abs(rotationDragDelta(identity, zero, at(-179), at(179)) + 2) < 1e-8);
  assert.equal(rotationDragDelta({ ...identity, a: 0 }, zero, at(0), at(10)), null);
  assert.equal(rotationDragDelta(identity, zero, zero, at(10)), null);
  const sheared = { a: -1.5, b: .8, c: .6, d: 2, e: 40, f: -30 };
  assert(Math.abs(rotationDragDelta(sheared, position, world(sheared, position, at(170)), world(sheared, position, at(190))) - 20) < 1e-8);
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const store = () => useProjectStore.getState();
  store().createCharacterTemplateProject();
  const first = structuredClone(store().frames[0]);
  const second = { ...structuredClone(first), id: 'rotation-second', nodeStates: { ...structuredClone(first.nodeStates), body: { ...structuredClone(first.nodeStates.body), rotation: 45, scale: { x: -1, y: 1 } } } };
  useProjectStore.setState({ frames: [first, second], currentFrameIndex: 1, selectedFrameIds: [first.id, second.id] });
  const before = structuredClone(store().frames);
  store().beginTransform('body');
  let degrees = 45, previous = at(170);
  for (let step = 1; step <= 36; step++) {
    const current = at(170 + step * 20);
    degrees += rotationDragDelta(identity, zero, previous, current);
    store().updateNodeFrame('body', { rotation: degrees });
    previous = current;
  }
  store().commitTransform();
  assert(Math.abs(store().frames[0].nodeStates.body.rotation - before[0].nodeStates.body.rotation - 720) < 1e-8);
  assert(Math.abs(store().frames[1].nodeStates.body.rotation - 765) < 1e-8);
  assert.equal(store().transformHistory.length, 1);
  const after = structuredClone(store().frames);
  store().undoTransform(); assert.deepEqual(store().frames, before);
  store().redoTransform(); assert.deepEqual(store().frames, after);
  console.log('PASS: H/V/double flips, mirrored/non-uniform/sheared parents, both rotation directions, angle wrap, two continuous turns, multi-frame editing and atomic undo/redo.');
} finally { await server.close(); }
