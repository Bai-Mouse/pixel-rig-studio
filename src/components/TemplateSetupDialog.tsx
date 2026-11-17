import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCharacterTemplateProject } from '../state/characterTemplate';
import type { AnimationFrame, ProjectSettings, RigNode, SpriteAsset, SpriteSlice, SpriteSource, Vec2 } from '../types/project';
import type { SerializableProject } from '../export/projectSerializer';
import { assetSource, filesToImportCandidates, rebindAssetSource, sourceFor, type SpriteImportCandidate } from '../utils/importPng';
import { clampSlice } from '../utils/sliceGeometry';
import { effectiveSpriteAnchor } from '../utils/spriteAnchor';
import { SourceCropEditor } from './SourceCropEditor';
import { Icon } from './Icon';
import '../template-setup.css';

interface TemplateDraft {
  assets: Record<string, SpriteAsset>;
  nodes: Record<string, RigNode>;
  rootNodeIds: string[];
  folders: string[];
  settings: ProjectSettings;
  frames: AnimationFrame[];
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface PartEntry {
  nodeId: string;
  nodeName: string;
  assetId: string;
  asset: SpriteAsset;
  index: number;
  count: number;
}

interface TemplateSetupDialogProps {
  onCancel: () => void;
  onCreate: (project: SerializableProject) => void;
}

const SHEET_ASSET_ID = 'character-template-sheet';

function matrixFor(nodeState: { position: Vec2; rotation: number; scale: Vec2 }): Matrix {
  const radians = nodeState.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * nodeState.scale.x,
    b: sine * nodeState.scale.x,
    c: -sine * nodeState.scale.y,
    d: cosine * nodeState.scale.y,
    e: nodeState.position.x,
    f: nodeState.position.y,
  };
}

function multiplyMatrices(parent: Matrix, child: Matrix): Matrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

function invertPoint(matrix: Matrix, point: Vec2): Vec2 | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 0.000001) return null;
  const x = point.x - matrix.e;
  const y = point.y - matrix.f;
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}

function orderedNodeIds(nodes: Record<string, RigNode>, roots: string[]): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    result.push(id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}

function partEntries(draft: TemplateDraft): PartEntry[] {
  const entries: PartEntry[] = [];
  orderedNodeIds(draft.nodes, draft.rootNodeIds).forEach((nodeId) => {
    const node = draft.nodes[nodeId];
    if (!node) return;
    node.assetIds.forEach((assetId, index) => {
      const asset = draft.assets[assetId];
      if (!asset) return;
      entries.push({ nodeId, nodeName: node.name, assetId, asset, index, count: node.assetIds.length });
    });
  });
  return entries;
}

export function TemplateSetupDialog({ onCancel, onCreate }: TemplateSetupDialogProps) {
  const [draft, setDraft] = useState<TemplateDraft>(() => createCharacterTemplateProject());
  const initialPositions = useRef<Record<string, Vec2>>(Object.fromEntries(
    Object.entries(draft.nodes).map(([nodeId, node]) => [nodeId, { ...node.transform.position }]),
  ));
  const parts = useMemo(() => partEntries(draft), [draft]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(() => parts[0]?.assetId ?? null);
  const [draftSlice, setDraftSlice] = useState<SpriteSlice | null>(null);
  const [message, setMessage] = useState('Pick a part, then drag its region on the sheet. When the pose looks right, create the project.');
  const [isBusy, setIsBusy] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [previewSize, setPreviewSize] = useState({ width: 360, height: 320 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ nodeId: string; startWorld: Vec2; startPosition: Vec2; parentMatrix: Matrix } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());

  const activeAssetId = selectedAssetId && draft.assets[selectedAssetId] ? selectedAssetId : parts[0]?.assetId ?? null;
  const activePart = parts.find((part) => part.assetId === activeAssetId) ?? null;
  const activeAsset = activeAssetId ? draft.assets[activeAssetId] : null;
  const sheetAsset = draft.assets[SHEET_ASSET_ID];
  const sheetSource = useMemo<SpriteSource | null>(() => (sheetAsset ? assetSource(sheetAsset) : null), [sheetAsset]);

  useEffect(() => {
    if (!activeAsset) return;
    setDraftSlice({ ...(activeAsset.slice ?? { x: 0, y: 0, width: activeAsset.width, height: activeAsset.height }) });
  }, [activeAssetId, activeAsset?.src, activeAsset?.width, activeAsset?.height]);

  const getImage = useCallback((src: string) => {
    const cached = images.current.get(src);
    if (cached) return cached;
    const image = new Image();
    image.onload = () => setImageVersion((value) => value + 1);
    image.src = src;
    images.current.set(src, image);
    return image;
  }, []);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewSize({ width: Math.max(160, entry.contentRect.width), height: Math.max(160, entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameStateFor = useCallback((nodeId: string) => {
    const node = draft.nodes[nodeId];
    return draft.frames[0]?.nodeStates[nodeId] ?? {
      position: node?.transform.position ?? { x: 0, y: 0 },
      rotation: node?.transform.rotation ?? 0,
      scale: node?.transform.scale ?? { x: 1, y: 1 },
      visible: node?.visible ?? true,
      imageIndex: 0,
      sortingOrder: node?.sortingOrder ?? 0,
    };
  }, [draft]);

  const worldMatrixFor = useCallback((nodeId: string): Matrix => {
    const node = draft.nodes[nodeId];
    if (!node) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const parent = node.parentId ? worldMatrixFor(node.parentId) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    return multiplyMatrices(parent, matrixFor(frameStateFor(nodeId)));
  }, [draft, frameStateFor]);

  const currentView = useCallback(() => {
    const { width, height } = previewSize;
    const { x: canvasWidth, y: canvasHeight } = draft.settings.canvasSize;
    const fitScale = Math.max(0.05, Math.min((width - 20) / canvasWidth, (height - 20) / canvasHeight));
    return { fitScale, scale: fitScale * zoom, offsetX: width / 2 + pan.x, offsetY: height / 2 + pan.y };
  }, [draft.settings.canvasSize, pan.x, pan.y, previewSize, zoom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = previewSize;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#141821';
    context.fillRect(0, 0, width, height);
    const { x: canvasWidth, y: canvasHeight } = draft.settings.canvasSize;
    const { scale, offsetX, offsetY } = currentView();
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    context.fillStyle = '#1d2230';
    context.fillRect(-canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);
    context.strokeStyle = 'rgba(175, 190, 245, .45)';
    context.lineWidth = 1 / scale;
    context.strokeRect(-canvasWidth / 2, -canvasHeight / 2, canvasWidth, canvasHeight);

    const drawnNodeIds = orderedNodeIds(draft.nodes, draft.rootNodeIds)
      .sort((leftId, rightId) => frameStateFor(leftId).sortingOrder - frameStateFor(rightId).sortingOrder);
    drawnNodeIds.forEach((nodeId) => {
      const node = draft.nodes[nodeId];
      const nodeState = frameStateFor(nodeId);
      if (!node || !node.visible || !nodeState.visible) return;
      const index = Math.max(0, Math.min(node.assetIds.length - 1, Math.round(nodeState.imageIndex)));
      const asset = draft.assets[node.assetIds[index]];
      if (!asset) return;
      const image = getImage(asset.src);
      if (!image.complete || !image.naturalWidth) return;
      const anchor = effectiveSpriteAnchor(asset, node.pivot);
      context.save();
      const world = worldMatrixFor(nodeId);
      context.transform(world.a, world.b, world.c, world.d, world.e, world.f);
      context.drawImage(image, -anchor.x, -anchor.y, asset.width, asset.height);
      context.restore();
    });

    // Outline the selected part so its node position can be nudged even when the pose uses another variant.
    if (activePart) {
      const node = draft.nodes[activePart.nodeId];
      const asset = activePart.asset;
      if (node && asset) {
        const world = worldMatrixFor(activePart.nodeId);
        const anchor = effectiveSpriteAnchor(asset, node.pivot);
        context.save();
        context.transform(world.a, world.b, world.c, world.d, world.e, world.f);
        context.strokeStyle = '#ffcf7a';
        context.lineWidth = 1 / scale;
        context.setLineDash([4 / scale, 3 / scale]);
        context.strokeRect(-anchor.x, -anchor.y, asset.width, asset.height);
        context.restore();
      }
    }
    context.restore();
  }, [activePart, currentView, draft, frameStateFor, getImage, worldMatrixFor]);

  useEffect(() => { draw(); }, [draw, imageVersion]);

  const hitNode = (worldPoint: Vec2): string | null => {
    const candidates = orderedNodeIds(draft.nodes, draft.rootNodeIds)
      .sort((leftId, rightId) => frameStateFor(rightId).sortingOrder - frameStateFor(leftId).sortingOrder);
    for (const nodeId of candidates) {
      const node = draft.nodes[nodeId];
      const nodeState = frameStateFor(nodeId);
      if (!node || !node.visible || !nodeState.visible) continue;
      const index = Math.max(0, Math.min(node.assetIds.length - 1, Math.round(nodeState.imageIndex)));
      const asset = draft.assets[node.assetIds[index]];
      if (!asset) continue;
      const anchor = effectiveSpriteAnchor(asset, node.pivot);
      const local = invertPoint(worldMatrixFor(nodeId), worldPoint);
      if (local && local.x >= -anchor.x && local.x <= asset.width - anchor.x && local.y >= -anchor.y && local.y <= asset.height - anchor.y) return nodeId;
    }
    return null;
  };

  const toWorld = (clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = currentView();
    return { x: (clientX - rect.left - offsetX) / scale, y: (clientY - rect.top - offsetY) / scale };
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextZoom = Math.max(0.5, Math.min(8, zoom * factor));
    if (nextZoom === zoom) return;
    const rect = canvas.getBoundingClientRect();
    const view = currentView();
    const nextScale = view.fitScale * nextZoom;
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const worldX = (pointerX - view.offsetX) / view.scale;
    const worldY = (pointerY - view.offsetY) / view.scale;
    setZoom(nextZoom);
    setPan({
      x: pointerX - worldX * nextScale - previewSize.width / 2,
      y: pointerY - worldY * nextScale - previewSize.height / 2,
    });
  };

  const zoomCentered = (factor: number) => {
    const nextZoom = Math.max(0.5, Math.min(8, zoom * factor));
    if (nextZoom === zoom) return;
    setPan((current) => ({ x: current.x * (nextZoom / zoom), y: current.y * (nextZoom / zoom) }));
    setZoom(nextZoom);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtRef.current(event.clientX, event.clientY, event.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const moveNode = (nodeId: string, position: Vec2) => {
    setDraft((current) => {
      const node = current.nodes[nodeId];
      if (!node) return current;
      const frame = current.frames[0];
      if (!frame) return current;
      return {
        ...current,
        nodes: {
          ...current.nodes,
          [nodeId]: { ...node, transform: { ...node.transform, position: { ...position } } },
        },
        frames: [{
          ...frame,
          nodeStates: { ...frame.nodeStates, [nodeId]: { ...frame.nodeStates[nodeId], position: { ...position } } },
        }, ...current.frames.slice(1)],
      };
    });
  };

  const applySheet = async (candidate: SpriteImportCandidate) => {
    setIsBusy(true);
    setMessage(`Applying ${candidate.name} to every part...`);
    try {
      const nextSource = sourceFor(candidate);
      const nextAssets: Record<string, SpriteAsset> = {};
      for (const asset of Object.values(draft.assets)) {
        if (asset.id === SHEET_ASSET_ID) {
          nextAssets[asset.id] = {
            ...asset,
            src: nextSource.src,
            width: nextSource.width,
            height: nextSource.height,
            source: nextSource,
            slice: { x: 0, y: 0, width: nextSource.width, height: nextSource.height },
          };
        } else if (asset.slice) {
          const slice = clampSlice(asset.slice, nextSource.width, nextSource.height);
          nextAssets[asset.id] = await rebindAssetSource(asset, nextSource, slice);
        } else {
          nextAssets[asset.id] = { ...asset, source: nextSource };
        }
      }
      setDraft((current) => ({ ...current, assets: nextAssets }));
      setMessage(`Applied ${candidate.name}. Parts kept the old slice rectangles; adjust any region that moved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not apply this PNG.');
    } finally {
      setIsBusy(false);
    }
  };

  const importSheet = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const candidates = await filesToImportCandidates(Array.from(files));
      const candidate = candidates[0];
      if (!candidate) throw new Error('Choose a PNG file.');
      await applySheet(candidate);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read this PNG.');
    }
  };

  const applyRegion = async () => {
    if (!activeAsset || !sheetSource || !draftSlice) return;
    setIsBusy(true);
    setMessage('Updating this part region...');
    try {
      const nextAsset = await rebindAssetSource(activeAsset, sheetSource, draftSlice);
      setDraft((current) => ({ ...current, assets: { ...current.assets, [nextAsset.id]: nextAsset } }));
      setMessage(`Updated the region for ${activePart?.nodeName ?? 'this part'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update this region.');
    } finally {
      setIsBusy(false);
    }
  };

  const resetPose = () => {
    setDraft((current) => {
      const nodes = { ...current.nodes };
      for (const [nodeId, position] of Object.entries(initialPositions.current)) {
        const node = nodes[nodeId];
        if (node) nodes[nodeId] = { ...node, transform: { ...node.transform, position: { ...position } } };
      }
      const frame = current.frames[0];
      const nodeStates = { ...frame.nodeStates };
      for (const [nodeId, position] of Object.entries(initialPositions.current)) {
        if (nodeStates[nodeId]) nodeStates[nodeId] = { ...nodeStates[nodeId], position: { ...position } };
      }
      return { ...current, nodes, frames: [{ ...frame, nodeStates }] };
    });
    setMessage('Pose reset to the built-in template.');
  };

  const resetTemplate = () => {
    const next = createCharacterTemplateProject();
    setDraft(next);
    initialPositions.current = Object.fromEntries(Object.entries(next.nodes).map(([nodeId, node]) => [nodeId, { ...node.transform.position }]));
    setSelectedAssetId(next.nodes[next.rootNodeIds[0]]?.assetIds[0] ?? null);
    setMessage('Template reset to the built-in character sheet.');
  };

  const createProject = () => {
    onCreate({
      assets: draft.assets,
      nodes: draft.nodes,
      rootNodeIds: draft.rootNodeIds,
      settings: draft.settings,
      frames: draft.frames,
      fps: 12,
      isLooping: true,
    });
  };

  return (
    <div className="template-setup-backdrop">
      <div className="template-setup" role="dialog" aria-modal="true" aria-label="Customize character template">
        <input ref={fileInputRef} type="file" accept="image/png,.png" hidden onChange={(event) => { void importSheet(event.target.files); event.currentTarget.value = ''; }} />
        <header className="template-setup-header">
          <div><strong>Customize character template</strong><small>Choose a sheet, map each part, nudge the pose, then create the project.</small></div>
          <button type="button" className="template-setup-close" onClick={onCancel} aria-label="Cancel">×</button>
        </header>
        <div className="template-setup-body">
          <aside className="template-part-list" aria-label="Template parts">
            <div className="template-part-heading"><span>Parts</span><em>{parts.length}</em></div>
            {parts.map((part) => (
              <button
                key={part.assetId}
                type="button"
                className={`template-part ${part.assetId === activeAssetId ? 'active' : ''}`}
                onClick={() => setSelectedAssetId(part.assetId)}
                title={`${part.nodeName} · sprite ${part.index + 1} of ${part.count}`}
              >
                <span className="template-part-thumb checkerboard"><img src={part.asset.src} alt="" /></span>
                <span className="template-part-text">
                  <strong>{part.nodeName}</strong>
                  <small>{part.count > 1 ? `sprite ${part.index + 1} / ${part.count}` : part.asset.name}</small>
                </span>
              </button>
            ))}
          </aside>
          <section className="template-crop-panel" aria-label="Part region">
            <div className="template-panel-heading">
              <strong>Sheet & part region</strong>
              {sheetSource && <small>{sheetSource.name} · {sheetSource.width} × {sheetSource.height}</small>}
            </div>
            <div className="template-sheet-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}><Icon name="import" size={13} /> Import PNG…</button>
              <button type="button" onClick={resetTemplate} disabled={isBusy}>Reset template</button>
            </div>
            {sheetSource && draftSlice
              ? <SourceCropEditor source={sheetSource} slice={draftSlice} onChange={setDraftSlice} />
              : <p className="template-hint">Select a part to edit its sheet region.</p>}
            <button type="button" className="template-apply" disabled={isBusy || !activeAsset || !draftSlice} onClick={() => void applyRegion()}>
              {isBusy ? 'Working...' : 'Apply region to part'}
            </button>
            <p className="template-hint">The region is cut from the current sheet. Other parts keep their own regions.</p>
          </section>
          <section className="template-pose-panel" aria-label="Pose preview">
            <div className="template-panel-heading">
              <strong>Pose preview</strong>
              <small>Click a part, then drag it on the canvas</small>
            </div>
            <div className="template-pose" ref={previewRef}>
              <canvas
                ref={canvasRef}
                onPointerDown={(event) => {
                  if (event.button === 1 || (event.button === 0 && !hitNode(toWorld(event.clientX, event.clientY)))) {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    panDragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
                    return;
                  }
                  if (event.button !== 0) return;
                  const worldPoint = toWorld(event.clientX, event.clientY);
                  const nodeId = hitNode(worldPoint);
                  if (!nodeId) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const node = draft.nodes[nodeId];
                  const parentMatrix = node?.parentId ? worldMatrixFor(node.parentId) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
                  dragRef.current = { nodeId, startWorld: worldPoint, startPosition: { ...frameStateFor(nodeId).position }, parentMatrix };
                  const nodeParts = parts.filter((part) => part.nodeId === nodeId);
                  setSelectedAssetId(nodeParts.find((part) => part.index === Math.round(frameStateFor(nodeId).imageIndex))?.assetId ?? nodeParts[0]?.assetId ?? null);
                }}
                onPointerMove={(event) => {
                  const panDrag = panDragRef.current;
                  if (panDrag) {
                    setPan({ x: panDrag.panX + event.clientX - panDrag.startX, y: panDrag.panY + event.clientY - panDrag.startY });
                    return;
                  }
                  const drag = dragRef.current;
                  if (!drag) return;
                  const worldPoint = toWorld(event.clientX, event.clientY);
                  const start = invertPoint(drag.parentMatrix, drag.startWorld);
                  const current = invertPoint(drag.parentMatrix, worldPoint);
                  if (!start || !current) return;
                  moveNode(drag.nodeId, { x: drag.startPosition.x + current.x - start.x, y: drag.startPosition.y + current.y - start.y });
                }}
                onPointerUp={() => { dragRef.current = null; panDragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; panDragRef.current = null; }}
              />
            </div>
            <div className="template-pose-actions">
              <div className="template-pose-zoom">
                <button type="button" aria-label="Zoom pose preview out" onClick={() => zoomCentered(1 / 1.5)}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" aria-label="Zoom pose preview in" onClick={() => zoomCentered(1.5)}>+</button>
                <button type="button" onClick={resetView}>Fit</button>
              </div>
              <button type="button" onClick={resetPose}>Reset pose</button>
              <span className="template-hint">Wheel: zoom · Middle or empty-space drag: pan · Drag a part to nudge it</span>
            </div>
          </section>
        </div>
        <footer className="template-setup-footer">
          <p className={message.startsWith('Could') || message.startsWith('Choose') ? 'template-message error' : 'template-message'}>{message}</p>
          <div>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="template-create" onClick={createProject}>Create project</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
