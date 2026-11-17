import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { inspectorFrameIds, useProjectStore } from '../state/projectStore';
import { nodeSpriteIdForFrame, type AnimationFrame, type NodeFrameState, type RigNode, type SpriteAsset, type TransformTool, type Vec2 } from '../types/project';
import { DEFAULT_PIXEL_ALPHA_THRESHOLD, snapToGrid } from './pixelRotation';
import { spriteRasterCache } from './spriteRasterCache';
import { rotationDragDelta } from './rotationDrag';
import { effectiveSpriteAnchor } from '../utils/spriteAnchor';

const imageCache = new Map<string, HTMLImageElement>();
let drawingPreview: { source: string; image: HTMLImageElement } | null = null;

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface TransformDrag {
  tool: Exclude<TransformTool, 'select'>;
  nodeId: string;
  startWorld: Vec2;
  parentMatrix: Matrix;
  nodeMatrix: Matrix;
  startState: NodeFrameState;
  rotationLastPoint: Vec2;
  rotationDegrees: number;
  startScaleAxes: Vec2;
}

const identityMatrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function frameStateFor(node: RigNode, frame: AnimationFrame): NodeFrameState {
  return frame.nodeStates[node.id] ?? {
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
    visible: node.visible,
    imageIndex: 0,
    sortingOrder: node.sortingOrder ?? 0,
  };
}

function matrixFromState(state: NodeFrameState): Matrix {
  const radians = state.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * state.scale.x,
    b: sine * state.scale.x,
    c: -sine * state.scale.y,
    d: cosine * state.scale.y,
    e: state.position.x,
    f: state.position.y,
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

function inverseTransformPoint(matrix: Matrix, point: Vec2): Vec2 | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 0.00001) return null;
  const x = point.x - matrix.e;
  const y = point.y - matrix.f;
  return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant };
}

/** Converts a world point into the node's rotated, but unscaled, local axes. */
function pointInNodeScaleAxes(parentMatrix: Matrix, state: NodeFrameState, worldPoint: Vec2): Vec2 | null {
  const pointInParent = inverseTransformPoint(parentMatrix, worldPoint);
  if (!pointInParent) return null;
  const x = pointInParent.x - state.position.x;
  const y = pointInParent.y - state.position.y;
  const radians = state.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: cosine * x + sine * y, y: -sine * x + cosine * y };
}

function scaledAxis(startScale: number, startAxis: number, currentAxis: number) {
  if (!Number.isFinite(startScale) || !Number.isFinite(startAxis) || !Number.isFinite(currentAxis) || Math.abs(startAxis) < 0.5) return startScale;
  const raw = startScale * currentAxis / startAxis;
  if (!Number.isFinite(raw)) return startScale;
  const sign = raw < 0 ? -1 : raw > 0 ? 1 : Math.sign(startScale) || 1;
  return sign * Math.min(16, Math.max(0.05, Math.abs(raw)));
}

function getWorldMatrix(nodes: Record<string, RigNode>, frame: AnimationFrame, nodeId: string, cache: Map<string, Matrix>): Matrix {
  const cached = cache.get(nodeId);
  if (cached) return cached;
  const node = nodes[nodeId];
  if (!node) return identityMatrix;
  const parent = node.parentId ? getWorldMatrix(nodes, frame, node.parentId, cache) : identityMatrix;
  const world = multiplyMatrices(parent, matrixFromState(frameStateFor(node, frame)));
  cache.set(nodeId, world);
  return world;
}

function orderedNodes(nodes: Record<string, RigNode>, roots: string[]) {
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

function getImage(src: string, onReady: () => void) {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.onload = onReady;
  image.src = src;
  imageCache.set(src, image);
  return image;
}

function getDrawingPreview(source: string, onReady: () => void) {
  if (drawingPreview?.source === source) return drawingPreview.image;
  const image = new Image();
  image.onload = onReady;
  image.src = source;
  drawingPreview = { source, image };
  return image;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, originX: number, originY: number, zoom: number, size: number) {
  const left = -originX / zoom;
  const right = (width - originX) / zoom;
  const top = -originY / zoom;
  const bottom = (height - originY) / zoom;
  const firstX = Math.floor(left / size) * size;
  const firstY = Math.floor(top / size) * size;
  context.lineWidth = 1 / zoom;
  context.strokeStyle = 'rgba(136, 151, 202, 0.16)';
  context.beginPath();
  for (let x = firstX; x <= right; x += size) { context.moveTo(x, top); context.lineTo(x, bottom); }
  for (let y = firstY; y <= bottom; y += size) { context.moveTo(left, y); context.lineTo(right, y); }
  context.stroke();
  context.strokeStyle = 'rgba(164, 178, 232, 0.42)';
  context.beginPath();
  context.moveTo(left, 0); context.lineTo(right, 0);
  context.moveTo(0, top); context.lineTo(0, bottom);
  context.stroke();
}

interface AnimationCanvasProps {
  showGrid: boolean;
}

export function AnimationCanvas({ showGrid }: AnimationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const assets = useProjectStore((state) => state.assets);
  const nodes = useProjectStore((state) => state.nodes);
  const roots = useProjectStore((state) => state.rootNodeIds);
  const settings = useProjectStore((state) => state.settings);
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId);
  const frames = useProjectStore((state) => state.frames);
  const currentFrameIndex = useProjectStore((state) => state.currentFrameIndex);
  const selectedFrameCount = useProjectStore((state) => inspectorFrameIds(state).length);
  const onionSkinEnabled = useProjectStore((state) => state.onionSkinEnabled);
  const activeTool = useProjectStore((state) => state.activeTool);
  const showPivot = useProjectStore((state) => state.showPivot);
  const snapEnabled = useProjectStore((state) => state.snapEnabled);
  const selectNode = useProjectStore((state) => state.selectNode);
  const setActiveTool = useProjectStore((state) => state.setActiveTool);
  const beginTransform = useProjectStore((state) => state.beginTransform);
  const updateNodeFrame = useProjectStore((state) => state.updateNodeFrame);
  const commitTransform = useProjectStore((state) => state.commitTransform);
  const updateNodePivot = useProjectStore((state) => state.updateNodePivot);
  const setAssetAnchorKeepingPixels = useProjectStore((state) => state.setAssetAnchorKeepingPixels);
  const duplicateNode = useProjectStore((state) => state.duplicateNode);
  const deleteNode = useProjectStore((state) => state.deleteNode);
  const undoTransform = useProjectStore((state) => state.undoTransform);
  const redoTransform = useProjectStore((state) => state.redoTransform);
  const dragRef = useRef<TransformDrag | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = '#161923';
    context.fillRect(0, 0, rect.width, rect.height);

    const originX = Math.round(rect.width / 2 + pan.x);
    const originY = Math.round(rect.height / 2 + pan.y);
    context.save();
    context.translate(originX, originY);
    context.scale(zoom, zoom);
    if (showGrid) drawGrid(context, rect.width, rect.height, originX, originY, zoom, settings.gridSize);

    context.fillStyle = '#1d2230';
    context.fillRect(-settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);
    context.strokeStyle = 'rgba(175, 190, 245, 0.52)';
    context.lineWidth = 1 / zoom;
    context.strokeRect(-settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);

    const drawNode = (node: RigNode, frame: AnimationFrame, showSelection: boolean, matrixCache: Map<string, Matrix>) => {
      const nodeState = frameStateFor(node, frame);
      if (!node.visible || !nodeState.visible) return;
      const worldMatrix = getWorldMatrix(nodes, frame, node.id, matrixCache);
      const assetId = nodeSpriteIdForFrame(node, nodeState);
      const asset: SpriteAsset | undefined = assetId ? assets[assetId] : undefined;
      if (asset) {
        const anchor = effectiveSpriteAnchor(asset, node.pivot);
        const image = getImage(asset.src, render);
        if (image.complete && image.naturalWidth) {
          const anchorX = snapToGrid(worldMatrix.e, settings.pixelGridSize);
          const anchorY = snapToGrid(worldMatrix.f, settings.pixelGridSize);
          const drawTransformOverlays = (translationX: number, translationY: number, drawBounds: boolean) => {
            if (!showSelection || node.id !== selectedNodeId) return;
            context.save();
            context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, translationX, translationY);
            context.strokeStyle = '#9ea9ff';
            context.lineWidth = 1 / zoom;
            if (drawBounds) context.strokeRect(-anchor.x - 2 / zoom, -anchor.y - 2 / zoom, asset.width + 4 / zoom, asset.height + 4 / zoom);
            if (showPivot || activeTool === 'pivot') {
              context.strokeStyle = activeTool === 'pivot' ? '#ffc578' : '#aeb7ff';
              context.beginPath();
              context.moveTo(-5 / zoom, 0); context.lineTo(5 / zoom, 0);
              context.moveTo(0, -5 / zoom); context.lineTo(0, 5 / zoom);
              context.stroke();
              context.beginPath();
              context.arc(0, 0, 3 / zoom, 0, Math.PI * 2);
              context.stroke();
            }
            if (activeTool === 'rotate') {
              const handleY = -anchor.y - 10 / zoom;
              context.beginPath();
              context.moveTo(0, -anchor.y); context.lineTo(0, handleY);
              context.stroke();
              context.fillStyle = '#ffa96f';
              context.fillRect(-2 / zoom, handleY - 2 / zoom, 4 / zoom, 4 / zoom);
            }
            if (activeTool === 'scale') {
              const handleX = asset.width - anchor.x + 4 / zoom;
              const handleY = asset.height - anchor.y + 4 / zoom;
              context.fillStyle = '#72d9bb';
              context.fillRect(handleX - 2 / zoom, handleY - 2 / zoom, 4 / zoom, 4 / zoom);
            }
            context.restore();
          };

          if (settings.pixelPerfectRotation) {
            const worldDeterminant = worldMatrix.a * worldMatrix.d - worldMatrix.b * worldMatrix.c;
            try {
              const rasterized = spriteRasterCache.get(asset.id, image, {
                angleRadians: Math.atan2(worldMatrix.b, worldMatrix.a),
                scaleX: Math.hypot(worldMatrix.a, worldMatrix.b),
                scaleY: Math.sign(worldDeterminant || 1) * Math.hypot(worldMatrix.c, worldMatrix.d),
                pivotX: anchor.x,
                pivotY: anchor.y,
                pixelGridSize: settings.pixelGridSize,
                alphaThreshold: DEFAULT_PIXEL_ALPHA_THRESHOLD,
                fillSinglePixelGaps: true,
                linearTransform: {
                  a: worldMatrix.a,
                  b: worldMatrix.b,
                  c: worldMatrix.c,
                  d: worldMatrix.d,
                },
              });
              context.drawImage(rasterized.canvas, anchorX + rasterized.offsetX, anchorY + rasterized.offsetY);
              if (showSelection && node.id === selectedNodeId) {
                context.save();
                context.strokeStyle = '#9ea9ff';
                context.lineWidth = 1 / zoom;
                context.strokeRect(
                  anchorX + rasterized.offsetX - 2 / zoom,
                  anchorY + rasterized.offsetY - 2 / zoom,
                  rasterized.width + 4 / zoom,
                  rasterized.height + 4 / zoom,
                );
                context.restore();
              }
              drawTransformOverlays(anchorX, anchorY, false);
            } catch {
              // A malformed or extreme scale should not take down the entire canvas.
              context.save();
              context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
              context.drawImage(image, -anchor.x, -anchor.y, asset.width, asset.height);
              context.restore();
              drawTransformOverlays(anchorX, anchorY, true);
            }
          } else {
            context.save();
            context.transform(worldMatrix.a, worldMatrix.b, worldMatrix.c, worldMatrix.d, anchorX, anchorY);
            context.drawImage(image, -anchor.x, -anchor.y, asset.width, asset.height);
            context.restore();
            drawTransformOverlays(anchorX, anchorY, true);
          }
        }
      }
    };
    const drawFrame = (frame: AnimationFrame | undefined, opacity: number, showSelection: boolean) => {
      if (!frame) return;
      context.save();
      context.globalAlpha = opacity;
      const matrixCache = new Map<string, Matrix>();
      orderedNodes(nodes, roots)
        .sort((leftId, rightId) => {
          const leftNode = nodes[leftId];
          const rightNode = nodes[rightId];
          return (leftNode ? frameStateFor(leftNode, frame).sortingOrder : 0) - (rightNode ? frameStateFor(rightNode, frame).sortingOrder : 0);
        })
        .forEach((id) => {
        const node = nodes[id];
        if (node) drawNode(node, frame, showSelection, matrixCache);
        });
      // Move and pivot tools mark node origins; the selected node also shows its world coordinates.
      if (showSelection && (activeTool === 'move' || activeTool === 'pivot')) {
        orderedNodes(nodes, roots).forEach((id) => {
          const node = nodes[id];
          if (!node) return;
          const selected = id === selectedNodeId;
          if (!selected && activeTool === 'pivot') {
            const nodeState = frameStateFor(node, frame);
            if (!node.visible || !nodeState.visible) return;
            const world = getWorldMatrix(nodes, frame, id, matrixCache);
            const size = 4 / zoom;
            context.save();
            context.globalAlpha = 0.55;
            context.strokeStyle = '#aeb7ff';
            context.lineWidth = 1 / zoom;
            context.beginPath();
            context.moveTo(world.e - size, world.f); context.lineTo(world.e + size, world.f);
            context.moveTo(world.e, world.f - size); context.lineTo(world.e, world.f + size);
            context.stroke();
            context.restore();
            return;
          }
          if (!selected) return;
          const nodeState = frameStateFor(node, frame);
          if (!node.visible || !nodeState.visible) return;
          const world = getWorldMatrix(nodes, frame, id, matrixCache);
          const size = 6 / zoom;
          context.save();
          context.strokeStyle = '#ffc578';
          context.lineWidth = 1 / zoom;
          context.beginPath();
          context.moveTo(world.e - size, world.f); context.lineTo(world.e + size, world.f);
          context.moveTo(world.e, world.f - size); context.lineTo(world.e, world.f + size);
          context.stroke();
          context.beginPath();
          context.arc(world.e, world.f, 3 / zoom, 0, Math.PI * 2);
          context.stroke();
          const name = node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name;
          const label = `${name}  ${Math.round(world.e)}, ${Math.round(world.f)}`;
          context.font = `${10 / zoom}px "Segoe UI", system-ui, sans-serif`;
          const labelWidth = context.measureText(label).width;
          const padding = 3 / zoom;
          const labelX = world.e + 9 / zoom;
          const labelTop = world.f - 17 / zoom;
          context.fillStyle = 'rgba(12, 14, 20, 0.82)';
          context.fillRect(labelX, labelTop, labelWidth + padding * 2, 14 / zoom);
          context.fillStyle = selected ? '#ffe0a8' : '#dfe4ff';
          context.fillText(label, labelX + padding, labelTop + 10.5 / zoom);
          context.restore();
        });
      }
      context.restore();
    };
    if (onionSkinEnabled) {
      drawFrame(frames[currentFrameIndex - 1], 0.16, false);
      drawFrame(frames[currentFrameIndex + 1], 0.11, false);
    }
    drawFrame(frames[currentFrameIndex], 1, true);
    const canvasData = frames[currentFrameIndex]?.canvasData;
    if (canvasData) {
      const drawing = getDrawingPreview(canvasData, render);
      if (drawing.complete && drawing.naturalWidth) {
        context.save();
        context.imageSmoothingEnabled = false;
        context.drawImage(drawing, -settings.canvasSize.x / 2, -settings.canvasSize.y / 2, settings.canvasSize.x, settings.canvasSize.y);
        context.restore();
      }
    }
    context.restore();
  }, [activeTool, assets, currentFrameIndex, frames, nodes, onionSkinEnabled, pan.x, pan.y, roots, selectedNodeId, settings, showGrid, showPivot, zoom]);

  useEffect(() => {
    render();
    const observer = new ResizeObserver(render);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(true); };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'd' && selectedNodeId) { event.preventDefault(); duplicateNode(selectedNodeId); }
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoTransform(); else undoTransform(); }
        if (key === 'y') { event.preventDefault(); redoTransform(); }
        return;
      }
      if (key === 'w') { event.preventDefault(); setActiveTool('move'); }
      if (key === 'r') { event.preventDefault(); setActiveTool('rotate'); }
      if (key === 's') { event.preventDefault(); setActiveTool('scale'); }
      if (key === 'p') { event.preventDefault(); setActiveTool('pivot'); }
      if (event.key === 'Delete' && selectedNodeId) { event.preventDefault(); deleteNode(selectedNodeId); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteNode, duplicateNode, redoTransform, selectedNodeId, setActiveTool, undoTransform]);

  const pointerToWorld = (event: React.PointerEvent<HTMLDivElement>): Vec2 | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const originX = Math.round(rect.width / 2 + pan.x);
    const originY = Math.round(rect.height / 2 + pan.y);
    return { x: (event.clientX - rect.left - originX) / zoom, y: (event.clientY - rect.top - originY) / zoom };
  };

  const hitTest = (worldPoint: Vec2, frame: AnimationFrame): string | null => {
    const cache = new Map<string, Matrix>();
    const nodeIds = orderedNodes(nodes, roots)
      .sort((leftId, rightId) => frameStateFor(nodes[leftId], frame).sortingOrder - frameStateFor(nodes[rightId], frame).sortingOrder)
      .reverse();
    for (const id of nodeIds) {
      const node = nodes[id];
      const nodeState = node ? frameStateFor(node, frame) : null;
      const assetId = node && nodeState ? nodeSpriteIdForFrame(node, nodeState) : null;
      const asset = assetId ? assets[assetId] : undefined;
      if (!node || !asset || !node.visible || !frameStateFor(node, frame).visible) continue;
      const anchor = effectiveSpriteAnchor(asset, node.pivot);
      const local = inverseTransformPoint(getWorldMatrix(nodes, frame, id, cache), worldPoint);
      if (local && local.x >= -anchor.x && local.x <= asset.width - anchor.x && local.y >= -anchor.y && local.y <= asset.height - anchor.y) return id;
    }
    return null;
  };

  return (
    <main className="canvas-workspace">
      <div className="canvas-header">
        <span className="canvas-title"><span className="live-dot" /> Animation canvas</span>
        <span className="canvas-size">{settings.canvasSize.x} × {settings.canvasSize.y}</span>
        {selectedFrameCount > 1 && <span className="canvas-batch-hint" title="Move, rotate and scale apply relatively to every selected frame">Editing {selectedFrameCount} selected frames</span>}
        <div className="zoom-controls">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - 1))}><Icon name="zoomOut" /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(16, value + 1))}><Icon name="zoomIn" /></button>
        </div>
      </div>
      <div
        ref={stageRef}
        className={`canvas-stage ${spaceDown || isPanning ? 'pan-ready' : ''} tool-${activeTool}`}
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(16, Math.max(1, value + (event.deltaY < 0 ? 1 : -1)))); }}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (spaceDown || event.button === 1) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
            setIsPanning(true);
            return;
          }
          const frame = frames[currentFrameIndex];
          const worldPoint = pointerToWorld(event);
          if (!frame || !worldPoint) return;
          const hitNodeId = hitTest(worldPoint, frame);
          if (activeTool === 'select') {
            selectNode(hitNodeId);
            return;
          }
          const node = selectedNodeId ? nodes[selectedNodeId] : null;
          if (!node || node.locked) return;
          const cache = new Map<string, Matrix>();
          const nodeMatrix = getWorldMatrix(nodes, frame, node.id, cache);
          const parentMatrix = node.parentId ? getWorldMatrix(nodes, frame, node.parentId, cache) : identityMatrix;
          const startState = frameStateFor(node, frame);
          const startLocal = inverseTransformPoint(nodeMatrix, worldPoint);
          if (activeTool === 'pivot' && !startLocal) return;
          if (activeTool === 'pivot' && startLocal) {
            const assetId = nodeSpriteIdForFrame(node, startState);
            const asset = assetId ? assets[assetId] : undefined;
            if (!asset) return;
            const anchor = effectiveSpriteAnchor(asset, node.pivot);
            const nextAnchor = {
              x: Math.min(asset.width, Math.max(0, Math.round(anchor.x + startLocal.x))),
              y: Math.min(asset.height, Math.max(0, Math.round(anchor.y + startLocal.y))),
            };
            // Re-anchor in place: with a custom anchor both the anchor and the node pose compensate,
            // otherwise the shared node pivot moves and already keeps pixels fixed.
            if (asset.anchor) setAssetAnchorKeepingPixels(asset.id, node.id, nextAnchor);
            else updateNodePivot(node.id, nextAnchor);
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            tool: activeTool,
            nodeId: node.id,
            startWorld: worldPoint,
            parentMatrix,
            nodeMatrix,
            startState: { ...startState, position: { ...startState.position }, scale: { ...startState.scale } },
            rotationLastPoint: worldPoint,
            rotationDegrees: startState.rotation,
            startScaleAxes: pointInNodeScaleAxes(parentMatrix, startState, worldPoint) ?? { x: 0, y: 0 },
          };
          beginTransform(node.id);
        }}
        onPointerMove={(event) => {
          if (dragStart.current) {
            setPan({ x: dragStart.current.panX + event.clientX - dragStart.current.x, y: dragStart.current.panY + event.clientY - dragStart.current.y });
            return;
          }
          const drag = dragRef.current;
          const worldPoint = pointerToWorld(event);
          if (!drag || !worldPoint) return;
          const snap = (value: number, increment = 1) => snapEnabled ? Math.round(value / increment) * increment : Math.round(value);
          if (drag.tool === 'move') {
            const start = inverseTransformPoint(drag.parentMatrix, drag.startWorld);
            const current = inverseTransformPoint(drag.parentMatrix, worldPoint);
            if (!start || !current) return;
            updateNodeFrame(drag.nodeId, { position: { x: snap(drag.startState.position.x + current.x - start.x, settings.gridSize), y: snap(drag.startState.position.y + current.y - start.y, settings.gridSize) } });
          }
          if (drag.tool === 'rotate') {
            const delta = rotationDragDelta(drag.parentMatrix, drag.startState.position, drag.rotationLastPoint, worldPoint);
            drag.rotationLastPoint = worldPoint;
            if (delta === null) return;
            drag.rotationDegrees += delta;
            updateNodeFrame(drag.nodeId, { rotation: drag.rotationDegrees });
          }
          if (drag.tool === 'scale') {
            const currentAxes = pointInNodeScaleAxes(drag.parentMatrix, drag.startState, worldPoint);
            if (!currentAxes) return;
            updateNodeFrame(drag.nodeId, {
              scale: {
                x: scaledAxis(drag.startState.scale.x, drag.startScaleAxes.x, currentAxes.x),
                y: scaledAxis(drag.startState.scale.y, drag.startScaleAxes.y, currentAxes.y),
              },
            });
          }
        }}
        onPointerUp={() => {
          dragStart.current = null;
          setIsPanning(false);
          if (dragRef.current) commitTransform();
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          setIsPanning(false);
          if (dragRef.current) commitTransform();
          dragRef.current = null;
        }}
      >
        <canvas ref={canvasRef} />
        <div className="canvas-help"><kbd>Scroll</kbd> zoom <span>•</span> <kbd>Middle mouse</kbd> or <kbd>Space + drag</kbd> pan</div>
      </div>
    </main>
  );
}
