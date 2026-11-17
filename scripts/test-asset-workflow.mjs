import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Browser image/canvas facade: verify source identity and crop coordinates without a GPU.
globalThis.Image = class {
  set src(value) { this._src = value; queueMicrotask(() => this.onload()); }
  get src() { return this._src; }
};
globalThis.document = { createElement: () => {
  let drawing;
  return { getContext: () => ({ drawImage: (...args) => { drawing = args; }, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), toDataURL: () => JSON.stringify([drawing[0].src, ...drawing.slice(1)]) };
} };
const server = await createServer({ configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
try {
  const png = await server.ssrLoadModule('/src/utils/importPng.ts');
  const geometry = await server.ssrLoadModule('/src/utils/sliceGeometry.ts');
  const { makeProjectCopy, isProtectedProjectPath } = await server.ssrLoadModule('/src/project/projectCopy.ts');
  const { useProjectStore } = await server.ssrLoadModule('/src/state/projectStore.ts');
  const { projectFile, parseProjectFile } = await server.ssrLoadModule('/src/export/projectSerializer.ts');
  const sourceA = { id: 'source-a', name: 'A.png', src: 'A', width: 32, height: 32 };
  const sourceB = { id: 'source-b', name: 'B.png', src: 'B', width: 64, height: 64 };
  const slice = { x: 4, y: 6, width: 8, height: 10 };
  const a = { id: 'a', name: 'arm.png', folder: 'Body', src: 'old-arm', width: 8, height: 10, source: sourceA, slice };
  const b = { ...a, id: 'b', name: 'leg.png' };
  const legacy = { id: 'legacy', name: 'old.png', folder: 'Body', src: 'old-image', width: 16, height: 16 };
  assert.equal(png.importedSources([a, b, legacy]).length, 2);
  const extra = await png.createAssetsFromSlices({ ...sourceA, sourceId: sourceA.id }, [slice]);
  assert.equal(extra[0].source.id, sourceA.id);
  assert.notEqual(extra[0].id, a.id);
  assert.equal(extra[0].src, JSON.stringify(['A', 4, 6, 8, 10, 0, 0, 8, 10]));
  const rebound = await png.rebindAssetSource(a, sourceB, slice);
  assert.equal(rebound.id, 'a'); assert.equal(rebound.source.id, 'source-b');
  assert.equal(b.source.id, 'source-a');
  assert.equal(rebound.src, JSON.stringify(['B', 4, 6, 8, 10, 0, 0, 8, 10]));
  const updated = await png.replaceAssetsFromSource([a, b, rebound, legacy], 'source-a', { ...sourceB, src: 'A-new' });
  assert.deepEqual(updated.map((asset) => asset.id), ['a', 'b']);
  assert(updated.every((asset) => asset.source.id === 'source-a' && asset.source.src === 'A-new'));
  await assert.rejects(png.replaceAssetsFromSource([a, b], 'source-a', { ...sourceB, width: 5, height: 5 }), /too small/);
  const oldUpdated = await png.replaceAssetsFromSource([legacy], png.assetSource(legacy).id, { ...sourceB });
  assert.equal(oldUpdated[0].id, legacy.id);
  assert.equal(oldUpdated[0].source.id, 'legacy-source-legacy');
  const shrink = await png.rebindAssetSource(a, { ...sourceB, width: 5, height: 5 }, slice);
  assert.deepEqual(shrink.slice, { x: 0, y: 0, width: 5, height: 5 });
  assert.deepEqual(geometry.resizeSlice(slice, 'nw', { x: -100, y: -100 }, 32, 32), { x: 0, y: 0, width: 12, height: 16 });
  assert.deepEqual(geometry.resizeSlice(slice, 'se', { x: 100, y: 100 }, 32, 32), { x: 4, y: 6, width: 28, height: 26 });
  assert.deepEqual(geometry.resizeSlice(slice, 'w', { x: 100, y: 0 }, 32, 32), { x: 11, y: 6, width: 1, height: 10 });
  assert.deepEqual(geometry.anchoredSlice(slice, { width: 10 }, { x: .5, y: .5 }, 32, 32), { x: 3, y: 6, width: 10, height: 10 });
  assert.deepEqual(geometry.anchoredSlice(slice, { x: 20, y: 20 }, { x: 1, y: 1 }, 32, 32), { x: 12, y: 10, width: 8, height: 10 });
  for (const handle of geometry.sliceHandles) {
    const result = geometry.resizeSlice(slice, handle, { x: -100, y: 100 }, 32, 32);
    assert(result.width >= 1 && result.height >= 1 && result.x >= 0 && result.y >= 0 && result.x + result.width <= 32 && result.y + result.height <= 32);
  }
  const store = () => useProjectStore.getState();
  store().createEmptyProject(); store().addAssets([a, b]);
  store().createNodeForAsset('a');
  const nodeId = store().selectedNodeId;
  const frames = store().frames;
  store().replaceAssets([rebound]);
  assert.equal(store().nodes[nodeId].assetIds[0], 'a'); assert.equal(store().frames, frames);
  store().undoTransform(); assert.equal(store().assets.a.source.id, 'source-a');
  store().redoTransform(); assert.equal(store().assets.a.source.id, 'source-b');
  store().undoTransform(); store().undoTransform(); assert.equal(store().assets.a, undefined);
  store().redoTransform(); assert.equal(store().assets.a.source.id, 'source-a');
  const project = { assets: store().assets, nodes: store().nodes, rootNodeIds: store().rootNodeIds, frames: store().frames, fps: store().fps, isLooping: store().isLooping, settings: store().settings };
  const copy = makeProjectCopy(project, 'Original');
  assert.equal(copy.path, null); assert.equal(copy.name, 'Original - Copy');
  assert.deepEqual(copy.project, project); assert.notEqual(copy.project.assets, project.assets);
  copy.project.nodes[nodeId].name = 'Changed copy'; assert.notEqual(project.nodes[nodeId].name, 'Changed copy');
  const roundTrip = parseProjectFile(JSON.stringify(projectFile(copy.project)));
  assert.equal(roundTrip.assets.a.source.id, 'source-a');
  assert(isProtectedProjectPath('C:/Projects/../Projects/Original.json', ['c:\\projects\\original.json']));
  assert(!isProtectedProjectPath('C:/Projects/Original - Copy.json', ['C:/Projects/Original.json']));
  console.log('PASS: PNG reuse, single-sprite rebinding, linked sheet replacement, legacy sources, resize/anchor bounds, asset undo/redo, independent project copy and save path guard.');
} finally { await server.close(); }
