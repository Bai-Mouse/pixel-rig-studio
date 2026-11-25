import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const { captureCodexProject, codexPrompt } = await server.ssrLoadModule('/src/codex/context.ts');
  const { applyEditPlan } = await server.ssrLoadModule('/src/codex/editPlan.ts');
  const { planUnits, selectedPlan } = await server.ssrLoadModule('/src/codex/planSelection.ts');
  const { activeStyleTerms, readStylePreferences, saveStylePreferences } = await server.ssrLoadModule('/src/codex/animationStyle.ts');
  const state = () => useProjectStore.getState();
  state().createCharacterTemplateProject();
  state().duplicateFrame();
  state().duplicateFrame();
  state().groupFrames([0, 1], 'Walk', '#7788ff');
  const before = captureCodexProject();
  const untouched = structuredClone(before);
  const pose = (nodeId, frameNumbers, rotation) => ({ type: 'set_node_frame', nodeId, frameNumbers, rotation });
  const plan = { message: 'Review edits', operations: [pose('body', [1, 2, 3], 15), pose('head', [1], 25)] };
  const units = planUnits(plan, before.frames, before.nodes);
  assert.equal(units.length, 3);
  assert.deepEqual(units[0].operations[0].operation.frameNumbers, [1, 2]);
  const subset = selectedPlan(plan, units, [1, 2]);
  const scope = { nodeId: 'body', frameIds: before.frames.slice(0, 2).map(({ id }) => id), referenceFrameId: before.frames[1].id };
  const after = applyEditPlan(before, subset, Object.keys(before.assets), scope);
  assert.equal(after.frames[0].nodeStates.body.rotation, 15);
  assert.equal(after.frames[1].nodeStates.body.rotation, 15);
  assert.deepEqual(after.frames[2], before.frames[2]);
  assert.deepEqual(after.frames[0].nodeStates.head, before.frames[0].nodeStates.head);
  assert.deepEqual(before, untouched);
  assert.throws(() => applyEditPlan(before, plan, Object.keys(before.assets), scope), /超出帧范围/);
  assert.throws(() => applyEditPlan(before, { ...plan, operations: [pose('head', [1], 15)] }, Object.keys(before.assets), scope), /超出节点范围/);
  const groupOperation = { type: 'group_frames', frameNumbers: [1, 3], name: 'Together', color: '#aabbcc' };
  const regroup = { ...plan, operations: [groupOperation, pose('body', [1], 15)] };
  const regroupUnits = planUnits(regroup, before.frames, before.nodes);
  const onlyGroup = applyEditPlan(before, selectedPlan(regroup, regroupUnits, [1]), Object.keys(before.assets));
  assert.equal(onlyGroup.frames[0].group.id, onlyGroup.frames[2].group.id);
  const structural = { ...plan, operations: [
    { type: 'add_frames', afterFrameNumber: 0, copyFromFrameNumber: 2, count: 1 },
    pose('body', [1], 20), pose('head', [2], 30),
  ] };
  const structuralUnits = planUnits(structural, before.frames, before.nodes);
  assert.throws(() => selectedPlan(structural, structuralUnits, [0]), /依赖时间轴结构/);
  const amended = selectedPlan(structural, structuralUnits, [2]);
  const newFrame = applyEditPlan(before, amended, Object.keys(before.assets), scope).frames[0];
  assert.equal(newFrame.nodeStates.body.rotation, 20);
  assert.deepEqual(newFrame.nodeStates.head, before.frames[1].nodeStates.head);
  const prompt = codexPrompt('edit', [], before, scope, [1, 2]);
  assert(prompt.includes('"selectedFrameNumbers":[1,2]'));
  assert(prompt.includes('"referenceFrameNumber":2'));
  assert(prompt.includes('"attachedImageFrameNumbers":[1,2]'));
  const stylesByKey = new Map();
  globalThis.localStorage = { getItem: (key) => stylesByKey.get(key), setItem: (key, value) => stylesByKey.set(key, value) };
  assert.deepEqual(readStylePreferences(), { custom: [], activeIds: [] });
  const custom = { id: 'custom-mechanical', label: '机械感', direction: '关节分段启动，几乎不回弹。' };
  saveStylePreferences({ custom: [custom], activeIds: ['heavy', custom.id, 'invalid'] });
  const restoredStyles = readStylePreferences();
  assert.deepEqual(restoredStyles, { custom: [custom], activeIds: ['heavy', custom.id] });
  const styles = activeStyleTerms(restoredStyles);
  assert.deepEqual(styles.map(({ label }) => label), ['沉重有力', '机械感']);
  const styledPrompt = codexPrompt('edit', [], before, scope, [], styles);
  assert(!prompt.includes('Selected animation style preferences'));
  assert(styledPrompt.includes('"label":"机械感","direction":"关节分段启动，几乎不回弹。"'));
  assert(styledPrompt.includes('follow the latest explicit request first'));
  state().applyCodexPlan(subset, before);
  assert.deepEqual(state().frames, after.frames);
  state().undoTransform();
  assert.deepEqual(state().frames, before.frames);
  console.log('PASS: scoped review, grouped partial edits, frame-number dependencies, attachment labels, immutable preview and single-step undo.');
} finally {
  await server.close();
}
