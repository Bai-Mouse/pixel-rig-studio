import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const { bendDistance, bendHandle, ikChain, nodePivotWorld, captureFootLock, solveTwoBone } = await server.ssrLoadModule('/src/state/twoBoneIk.ts');
  const { projectFile, parseProjectFile, animationDataFile } = await server.ssrLoadModule('/src/export/projectSerializer.ts');
  const state = useProjectStore.getState;
  const vec = (x, y) => ({ x, y });
  const pose = (x, y, rotation = 0, scale = vec(1, 1)) => ({ position: vec(x, y), rotation, scale, sortingOrder: 0, visible: true, imageIndex: 0 });
  const makeNode = (id, parentId, children, transform) => ({ id, name: id, parentId, children, transform, visible: true, locked: false, pivot: vec(0, 0), assetIds: [], assetId: null });
  const nodes = Object.fromEntries([
    makeNode('body', null, ['hip', 'hip2'], pose(0, 0, 15, vec(-1.4, 1.2))),
    makeNode('hip', 'body', ['knee'], pose(-3, 0, 0, vec(.8, 1.2))),
    makeNode('knee', 'hip', ['foot'], pose(0, 5, 45)),
    makeNode('foot', 'knee', [], pose(0, 4)),
    makeNode('hip2', 'body', ['knee2'], pose(3, 0)),
    makeNode('knee2', 'hip2', ['foot2'], pose(0, 5, -45)),
    makeNode('foot2', 'knee2', [], pose(0, 4)),
  ].map((node) => [node.id, node]));
  const initial = [0, .2, .4].map((x, i) => ({
    id: `test-${i}`, canvasData: `drawing-${i}`, nodeStates: {
      ...Object.fromEntries(Object.values(nodes).map((node) => [node.id, structuredClone(node.transform)])),
      body: { ...nodes.body.transform, position: vec(x, 0) },
    },
  }));
  const point = (frame, id = 'foot') => nodePivotWorld(nodes, frame, id);
  const close = (actual, expected, tolerance = .006) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < tolerance, JSON.stringify({ actual, expected }));
  const seed = initial[0];
  const start = captureFootLock(nodes, seed, 'foot');
  const target = vec(start.point.x + 1, start.point.y - 2);
  const solve = solveTwoBone(nodes, seed, 'foot', target, seed, false, start.axis);
  close(point(solve.frame), target);
  const counterPose = solveTwoBone(nodes, solve.frame, 'foot', target, solve.frame, true, start.axis);
  close(point(counterPose.frame), target);
  assert.ok(solve.frame.nodeStates.knee.rotation > 0);
  assert.ok(counterPose.frame.nodeStates.knee.rotation < 0);
  assert.deepEqual(solve.frame.nodeStates.foot.position, seed.nodeStates.foot.position);
  assert.deepEqual(solve.frame.nodeStates.hip.scale, seed.nodeStates.hip.scale);
  const normalize = (v) => { const mag = Math.hypot(v.x, v.y); return vec(v.x / mag, v.y / mag); };
  close(normalize(captureFootLock(nodes, solve.frame, 'foot').axis), normalize(start.axis), .0001);
  const far = solveTwoBone(nodes, seed, 'foot', vec(400, 400));
  assert.ok(far.error > 300);
  assert.ok(Math.hypot(far.actual.x, far.actual.y) < 30);

  useProjectStore.setState({ frames: initial, nodes, rootNodeIds: ['body'], currentFrameIndex: 0,
    selectedFrameIds: [initial[0].id, initial[2].id], transformHistory: [], redoStack: [] });
  assert.ok(ikChain(nodes, 'foot'), 'legacy projects auto-detect the chain');
  assert.equal(state().setIkBinding('body', 'Invalid'), 'Enter a name and select a tip below two joints.');
  assert.equal(state().setIkBinding('foot', ' Left Foot '), null);
  const binding = { name: 'Left Foot', upperId: 'hip', lowerId: 'knee' };
  assert.deepEqual(state().nodes.foot.ikBinding, binding);
  assert.deepEqual(parseProjectFile(JSON.stringify(projectFile(state()))).nodes.foot.ikBinding, binding);
  const changedHierarchy = { ...state().nodes, foot: { ...state().nodes.foot, parentId: 'knee2' } };
  assert.equal(ikChain(changedHierarchy, 'foot'), null, 'an explicit binding does not silently retarget after reparenting');
  assert.equal(state().setIkBinding('foot', null), null);
  assert.equal(state().nodes.foot.ikBinding, undefined);
  state().undoTransform();
  assert.deepEqual(state().nodes.foot.ikBinding, binding);
  state().undoTransform();
  assert.equal(state().nodes.foot.ikBinding, undefined);
  state().redoTransform();
  assert.deepEqual(state().nodes.foot.ikBinding, binding);
  state().undoTransform();
  assert.equal(state().beginIk('foot'), true);
  state().dragIk(vec(1, -2));
  state().dragIk(vec(0, 0));
  state().commitTransform();
  assert.equal(state().transformHistory.length, 0);
  assert.equal(state().beginIk('foot'), true);
  state().dragIk(vec(1, -2));
  state().commitTransform();
  close(point(state().frames[0]), target);
  close(point(state().frames[2]), vec(target.x + .4, target.y));
  assert.deepEqual(state().frames[1], initial[1]);
  state().undoTransform();
  assert.deepEqual(state().frames, initial);
  state().redoTransform();
  assert.equal(state().toggleFootLock('foot'), null);
  assert.equal(state().toggleFootLock('foot2'), null);
  assert.equal(state().beginIk('foot'), false);
  const planted = state().frames;
  const checkPlanted = () => [0, 2].forEach((i) => {
    close(point(state().frames[i]), planted[0].footLocks.foot.point);
    close(point(state().frames[i], 'foot2'), planted[0].footLocks.foot2.point);
    assert.equal(state().frames[i].canvasData, initial[i].canvasData);
  });
  checkPlanted();
  const root = point(planted[0], 'hip'), knee = point(planted[0], 'knee'), tip = point(planted[0]);
  const originalSide = Math.sign(bendDistance(root, tip, knee));
  for (const zoom of [1, 5, 16]) {
    assert.equal(Math.sign(bendDistance(root, tip, bendHandle(root, knee, tip, zoom))), originalSide);
  }
  assert.equal(state().beginIk('foot', 'bend'), true, 'the joint may bend even while its tip is planted');
  state().dragIkBend(-originalSide);
  state().commitTransform();
  assert.equal(Math.sign(bendDistance(root, tip, point(state().frames[0], 'knee'))), -originalSide);
  checkPlanted();
  assert.deepEqual(state().frames[1], initial[1]);
  state().undoTransform();
  assert.deepEqual(state().frames, planted);
  state().redoTransform();
  checkPlanted();
  state().undoTransform();
  state().beginTransform('body');
  state().updateNodeFrame('body', { position: vec(.5, .25) });
  close(state().frames[0].nodeStates.body.position, vec(.5, .25));
  checkPlanted();
  state().updateNodeFrame('body', { position: vec(200, 0) });
  state().commitTransform();
  assert.ok(state().frames[0].nodeStates.body.position.x > 0 && state().frames[0].nodeStates.body.position.x < 30);
  checkPlanted();
  state().undoTransform();
  assert.deepEqual(state().frames, planted);
  state().redoTransform();
  checkPlanted();
  state().undoTransform();
  const beforeInspector = state().frames;
  state().beginInspectorEdit('body');
  state().updateInspectorFrame('body', { position: vec(0, .5) });
  state().commitInspectorEdit();
  close(state().frames[0].nodeStates.body.position, vec(0, .5));
  checkPlanted();
  state().undoTransform();
  assert.deepEqual(state().frames, beforeInspector);

  const saved = JSON.stringify(projectFile(state()));
  assert.deepEqual(parseProjectFile(saved).frames[0].footLocks, planted[0].footLocks);
  assert.equal(animationDataFile(state()).frames[0].footLocks, undefined);
  const malformed = JSON.parse(saved);
  malformed.animation.frames[0].footLocks = { foot: null, foot2: { upperId: 'hip2', lowerId: 'knee2' } };
  assert.equal(parseProjectFile(JSON.stringify(malformed)).frames[0].footLocks, undefined);
  assert.equal(state().toggleFootLock('foot'), null);
  assert.equal(state().frames[0].footLocks.foot, undefined);
  state().undoTransform();
  assert.deepEqual(state().frames, planted);
  console.log('Two-bone IK, named bindings, bend control, mirrored scale, planted feet, batch edits, history and persistence passed.');
} finally {
  await server.close();
}
