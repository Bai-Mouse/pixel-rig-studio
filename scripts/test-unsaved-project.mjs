import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
try {
  const { hasUnsavedProjectChanges, canCloseProject } = await server.ssrLoadModule('/src/project/unsavedProject.ts');
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const state = useProjectStore.getState;
  const snapshot = () => {
    const { assets, nodes, rootNodeIds, settings, frames, fps, isLooping } = state();
    return { assets, nodes, rootNodeIds, settings, frames, fps, isLooping };
  };
  state().createEmptyProject();
  const checkpoint = { snapshot: snapshot() };
  assert.equal(hasUnsavedProjectChanges(null, snapshot()), false, 'startup screen has no active project');
  assert.equal(hasUnsavedProjectChanges(checkpoint, snapshot()), false, 'untouched blank project');
  assert.equal(hasUnsavedProjectChanges({ ...checkpoint, needsFirstSave: true }, snapshot()), true, 'copies and configured templates need a first save');
  state().setActiveTool('ik');
  assert.equal(hasUnsavedProjectChanges(checkpoint, snapshot()), false, 'editor-only tools do not dirty the project');
  state().insertFrame();
  assert.equal(hasUnsavedProjectChanges(checkpoint, snapshot()), true);
  state().undoTransform();
  assert.equal(hasUnsavedProjectChanges(checkpoint, snapshot()), false);
  assert.equal(hasUnsavedProjectChanges(checkpoint, structuredClone(snapshot())), false, 'identical undo snapshots can have new references');
  const prior = snapshot();
  assert.equal(hasUnsavedProjectChanges(checkpoint, { ...prior, frames: prior.frames.map(f => ({ ...f, canvasData: 'data:image/png;base64,pixels' })) }), true);
  state().setFps(state().fps === 24 ? 12 : 24);
  assert.equal(hasUnsavedProjectChanges(checkpoint, snapshot()), true);
  const writtenSnapshot = { snapshot: snapshot() };
  assert.equal(hasUnsavedProjectChanges(writtenSnapshot, snapshot()), false, 'successful save resets the checkpoint');
  state().insertFrame();
  assert.equal(hasUnsavedProjectChanges(writtenSnapshot, snapshot()), true, 'edits during a save stay unsaved');

  assert.equal(canCloseProject('cancel', false, true), false);
  assert.equal(canCloseProject('discard', false, true), true);
  assert.equal(canCloseProject('save', false, true), false, 'a cancelled or failed save stays open');
  assert.equal(canCloseProject('save', true, true), false, 'new edits during the write stay open');
  assert.equal(canCloseProject('save', true, false), true);
  console.log('Exit-save checkpoint, edits and undo, cancellation, failed saves and changed-during-save cases passed.');
} finally {
  await server.close();
}
