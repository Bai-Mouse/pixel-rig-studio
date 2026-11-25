import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { hitGizmo, hitTransformHandle, moveGizmoPosition, transformControl, transformShortcuts, transformToolForKey } = await server.ssrLoadModule('/src/canvas/transformControls.ts');
  assert.deepEqual(transformShortcuts, { select: 'V', move: 'W', rotate: 'R', scale: 'S', pivot: 'P', ik: 'I' });
  for (const [tool, letter] of Object.entries(transformShortcuts)) {
    assert.equal(transformToolForKey({ key: letter.toLowerCase(), code: `Key${letter}` }), tool);
    assert.equal(transformToolForKey({ key: letter, code: `Key${letter}` }), tool);
    assert.equal(transformToolForKey({ key: 'Unidentified', code: `Key${letter}` }), tool);
  }
  assert.equal(transformToolForKey({ key: 'Tab', code: 'Tab' }), undefined);
  const matrix = { a: -2, b: .5, c: .25, d: 1.2, e: 3, f: -4 };
  const sprite = { width: 19, height: 12, anchor: { x: 5, y: 3 } };
  for (const zoom of [1, 5, 16]) {
    for (const tool of ['scale', 'pivot']) {
      const control = transformControl(tool, matrix, zoom, sprite);
      const { center } = control;
      assert.ok(hitTransformHandle(center, center, zoom));
      assert.ok(hitTransformHandle({ x: center.x + 8 / zoom, y: center.y }, center, zoom));
      assert.ok(!hitTransformHandle({ x: center.x + 10 / zoom, y: center.y }, center, zoom));
      if (tool === 'pivot') assert.deepEqual(center, { x: matrix.e, y: matrix.f });
      if (tool === 'scale') assert.ok(center.x < matrix.e, 'scale handle follows the flipped sprite corner');
    }
    const center = { x: matrix.e, y: matrix.f };
    const hit = (tool, x, y) => hitGizmo(tool, { x: center.x + x / zoom, y: center.y + y / zoom }, center, zoom);
    assert.equal(hit('move', 44, 0), 'x');
    assert.equal(hit('move', 0, -44), 'y');
    assert.equal(hit('move', 15, -16), 'plane');
    assert.equal(hit('move', 15, 16), null);
    assert.equal(hit('rotate', -32, 0), 'ring');
    assert.equal(hit('rotate', 0, 32), 'ring');
    assert.equal(hit('rotate', 6, 6), null);
    assert.equal(hit('ik', 0, 0), 'center');
    assert.equal(hit('ik', 0, -24), 'ring');
    assert.equal(hit('ik', 0, -13), null);
  }
  const origin = { x: 10, y: -3 };
  for (const [part, expectedX, expectedY] of [['x', 8, 0], ['y', 0, 12], ['plane', 8, 12]]) {
    const result = moveGizmoPosition(matrix, origin, { x: 7.1, y: 11.1 }, part, 4);
    const x = result.x - origin.x;
    const y = result.y - origin.y;
    assert.ok(Math.abs(matrix.a * x + matrix.c * y - expectedX) < 1e-8);
    assert.ok(Math.abs(matrix.b * x + matrix.d * y - expectedY) < 1e-8);
  }
  assert.equal(moveGizmoPosition({ ...matrix, a: 0, b: 0 }, origin, { x: 5, y: 3 }, 'plane', 1), null);
  assert.ok(!hitTransformHandle({ x: 0, y: 0 }, null, 5));
  assert.equal(transformControl('select', matrix, 5, sprite), null);
  console.log('Tool bindings and transform handle hit areas passed at multiple zooms and mirrored scale.');
} finally {
  await server.close();
}
